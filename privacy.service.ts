import { createHmac } from 'node:crypto';
import { privacySaltCache } from '../../../infrastructure/redis/privacy-salt.cache';

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

function computeVisitorId(ip: string, userAgent: string, siteId: string, salt: string): string {
  const anonymizedIp = anonymizeIp(ip);
  const hash = createHmac('sha256', salt)
    .update(`${anonymizedIp}|${userAgent}|${siteId}`)
    .digest();
  return hash.readBigUInt64BE(0).toString();
}

export const privacyService = {
  // The salt rotates daily, which is what keeps visitor_id non-personal: the same visitor is a
  // different id tomorrow. A salt outliving the day would turn it into a persistent identifier.
  async resolveVisitorId(ip: string, userAgent: string, siteId: string): Promise<string> {
    const salt = await privacySaltCache.getTodaysSalt();
    return computeVisitorId(ip, userAgent, siteId, salt);
  },
};
