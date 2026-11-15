import { describe, expect, it } from 'vitest';
import { MemoryUserRateLimiter } from './user-rate-limiter.js';

describe('MemoryUserRateLimiter', () => {
  it('allows up to the limit per user and window', () => {
    let now = 0;
    const limiter = new MemoryUserRateLimiter(() => now);
    expect(limiter.consume('b', 'u1', 2, 1000)).toBe(true);
    expect(limiter.consume('b', 'u1', 2, 1000)).toBe(true);
    expect(limiter.consume('b', 'u1', 2, 1000)).toBe(false);
    // other users and buckets are independent
    expect(limiter.consume('b', 'u2', 2, 1000)).toBe(true);
    expect(limiter.consume('other', 'u1', 2, 1000)).toBe(true);
    // the window slides
    now = 1000;
    expect(limiter.consume('b', 'u1', 2, 1000)).toBe(true);
  });
});
