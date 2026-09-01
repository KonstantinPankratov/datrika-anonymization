import { createHmac, randomInt } from 'node:crypto';
import { privacySaltCache } from '../../../infrastructure/redis/privacy-salt.cache';
import { visitorSessionCache, VisitorSessionState } from '../../../infrastructure/redis/visitor-session.cache';
import { TrafficSourceDTO } from '../dto/traffic-source.dto';

export interface ResolvedPageViewSession {
  visitor_id: string;
  session_id: number;
  isNewSession: boolean;
  previousState: VisitorSessionState | null;
  currentState: VisitorSessionState;
}

function anonymizeIp(ip: string): string {
  if (!ip) return '0.0.0.0';

  if (ip.includes('.')) {
    return ip.split('.').slice(0, 3)
      .join('.') + '.0';
  }

  if (ip.includes(':')) {
    return ip.split(':').slice(0, 4)
      .join(':') + '::';
  }

  return ip;
}

function hasTrafficSourceChanged(cached: VisitorSessionState, current: TrafficSourceDTO): boolean {
  const isInternalNavigation = current.referrerMedium === 'internal';

  const hasCampaignChanged = (
    (Boolean(current.utmSource) && cached.utmSource !== current.utmSource)
    || (Boolean(current.utmMedium) && cached.utmMedium !== current.utmMedium)
    || (Boolean(current.utmCampaign) && cached.utmCampaign !== current.utmCampaign)
  );

  const hasReferralChanged = !isInternalNavigation
    && current.referrerSource !== 'none'
    && (cached.referrer !== current.referrerSource || cached.referrerMedium !== current.referrerMedium);

  return hasCampaignChanged || hasReferralChanged;
}

export interface ResolvedVisitorSession {
  visitor_id: string;
  session_id: number;
  cachedSession: VisitorSessionState;
}

export interface HeartbeatResult {
  visitor_id: string;
  previousState: VisitorSessionState;
  currentState: VisitorSessionState;
}

function computeVisitorId(ip: string, userAgent: string, siteId: string, salt: string): string {
  const anonymizedIp = anonymizeIp(ip);
  const hash = createHmac('sha256', salt)
    .update(`${anonymizedIp}|${userAgent}|${siteId}`)
    .digest();
  return hash.readBigUInt64BE(0).toString();
}

async function resolveVisitorId(ip: string, userAgent: string, siteId: string): Promise<string> {
  const salt = await privacySaltCache.getTodaysSalt();
  return computeVisitorId(ip, userAgent, siteId, salt);
}

export const privacyService = {
  async findVisitorSession(
    ip: string,
    userAgent: string,
    siteId: string,
  ): Promise<ResolvedVisitorSession | null> {
    const visitor_id = await resolveVisitorId(ip, userAgent, siteId);

    const cachedSession = await visitorSessionCache.get(visitor_id);
    if (!cachedSession) return null;

    return {
      visitor_id,
      session_id: cachedSession.id,
      cachedSession,
    };
  },

  async recordHeartbeat(
    ip: string,
    userAgent: string,
    siteId: string,
    engagedDeltaSeconds: number,
    receivedAt: Date,
  ): Promise<HeartbeatResult | null> {
    const visitor_id = await resolveVisitorId(ip, userAgent, siteId);

    const cachedSession = await visitorSessionCache.get(visitor_id);
    if (!cachedSession) return null;

    const previousState: VisitorSessionState = { ...cachedSession };
    const currentState: VisitorSessionState = {
      ...cachedSession,
      lastTs: receivedAt.getTime(),
      engagedSeconds: cachedSession.engagedSeconds + engagedDeltaSeconds,
    };

    await visitorSessionCache.set(visitor_id, currentState);

    return {
      visitor_id,
      previousState,
      currentState,
    };
  },

  /**
   * Works out what the session becomes after this page view without writing anything: the caller
   * decides whether the event is billable before any state moves, and hands `currentState` to
   * {@link commitVisitorSession} once it is. Always resolves - a page view either continues the
   * cached session or starts a new one, it is never rejected here.
   *
   * `receivedAt` must be the same timestamp the page_view row is stored with: a session's
   * `started_at` is what the dashboard uses as the lower bound when it reads the session's steps
   * back, so a session stamped even a millisecond later than its own entry page view would hide
   * that page view from the journey timeline.
   */
  async readPageViewSession(
    ip: string,
    userAgent: string,
    siteId: string,
    traffic: TrafficSourceDTO,
    currentUrl: string,
    receivedAt: Date,
  ): Promise<ResolvedPageViewSession> {
    const visitor_id = await resolveVisitorId(ip, userAgent, siteId);

    const now = receivedAt.getTime();
    const cachedSession = await visitorSessionCache.get(visitor_id);

    const sessionExists = cachedSession && !hasTrafficSourceChanged(cachedSession, traffic);

    if (sessionExists) {
      return {
        visitor_id,
        session_id: cachedSession.id,
        isNewSession: false,
        previousState: { ...cachedSession },
        currentState: {
          ...cachedSession,
          lastTs: now,
          exitUrl: currentUrl,
          pageViewsCount: cachedSession.pageViewsCount + 1,
        },
      };
    }

    const newState: VisitorSessionState = {
      id: randomInt(1, 4294967295),
      startedAt: now,
      lastTs: now,
      engagedSeconds: 0,
      pageViewsCount: 1,
      hasInteracted: false,
      entryUrl: currentUrl,
      exitUrl: currentUrl,
      utmSource: traffic.utmSource || '',
      utmMedium: traffic.utmMedium || '',
      utmCampaign: traffic.utmCampaign || '',
      utmContent: traffic.utmContent || '',
      utmTerm: traffic.utmTerm || '',
      referrer: traffic.referrerSource,
      referrerMedium: traffic.referrerMedium,
    };

    return {
      visitor_id,
      session_id: newState.id,
      isNewSession: true,
      previousState: null,
      currentState: newState,
    };
  },

  async commitVisitorSession(visitorId: string, state: VisitorSessionState): Promise<void> {
    await visitorSessionCache.set(visitorId, state);
  },
};
