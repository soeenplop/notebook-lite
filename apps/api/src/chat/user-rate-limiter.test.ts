import { describe, expect, it } from 'vitest';
import { UserRateLimiter } from './user-rate-limiter.js';

describe('UserRateLimiter', () => {
  it('allows `limit` requests per window and user', () => {
    let now = 0;
    const limiter = new UserRateLimiter(2, 60_000, () => now);
    expect(limiter.take('a')).toEqual({ allowed: true });
    expect(limiter.take('a')).toEqual({ allowed: true });
    expect(limiter.take('b')).toEqual({ allowed: true });
    now = 15_000;
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSeconds: 45 });
    now = 60_000;
    expect(limiter.take('a')).toEqual({ allowed: true });
  });
});
