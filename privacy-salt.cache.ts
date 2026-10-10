import { createPrivacySaltCache } from '@shared/redis';
import { config } from '../config';

export const privacySaltCache = createPrivacySaltCache({
  ttlSeconds: Math.floor(config.PRIVACY_SALT_TTL_MS / 1000),
});
