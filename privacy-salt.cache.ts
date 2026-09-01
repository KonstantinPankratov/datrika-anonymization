import { config } from '../config';
import { internalRedisClient, millisecondsToSeconds } from './internal-client';
import { redisKeys } from '@shared/redis';
import { randomBytes } from 'node:crypto';

const generateSalt = () => randomBytes(16).toString('hex');

let _memCache: {
  date: string;
  salt: string;
} | null = null;

export const privacySaltCache = {
  async getTodaysSalt(): Promise<string> {
    const today = new Date().toISOString()
      .split('T')[0];

    if (_memCache?.date === today) return _memCache.salt;

    const key = redisKeys.privacySalt(today);
    let salt = await internalRedisClient.get(key);

    if (!salt) {
      const newSalt = generateSalt();
      const ttlSeconds = millisecondsToSeconds(config.PRIVACY_SALT_TTL_MS);
      const acquired = await internalRedisClient.set(key, newSalt, 'EX', ttlSeconds, 'NX');
      if (acquired === null) {
        const existingSalt = await internalRedisClient.get(key);
        if (!existingSalt) throw new Error('Privacy salt race: another node won the lock but the key is gone');
        salt = existingSalt;
      }
      else {
        salt = newSalt;
      }
    }

    _memCache = {
      date: today,
      salt,
    };
    return salt;
  },

  async clear(): Promise<void> {
    const keys = await internalRedisClient.keys(redisKeys.privacySaltPattern);
    if (keys.length > 0) {
      await internalRedisClient.del(...keys);
    }
  },
};
