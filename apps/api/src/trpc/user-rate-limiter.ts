/**
 * Per-user limits for expensive tRPC procedures (on top of the global per-IP limit).
 * Plain class (no Nest): it is part of the tRPC context type.
 */
export interface UserRateLimiter {
  /**
   * Counts one call of `bucket` for `userId`. Returns false (and counts nothing) when the user
   * already made `limit` calls within the last `windowMs`.
   */
  consume(bucket: string, userId: string, limit: number, windowMs: number): boolean;
}

/**
 * In-memory sliding-window limiter. Good enough for a single API instance; with several
 * instances each would enforce the limit separately (then move it to Postgres or Redis).
 */
export class MemoryUserRateLimiter implements UserRateLimiter {
  readonly #hits = new Map<string, number[]>();
  readonly #now: () => number;
  /** Prune all keys every this many calls so idle users don't accumulate. */
  #callsUntilPrune = 1000;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  consume(bucket: string, userId: string, limit: number, windowMs: number): boolean {
    const now = this.#now();
    this.#maybePrune(now, windowMs);
    const key = `${bucket}:${userId}`;
    const hits = (this.#hits.get(key) ?? []).filter((time) => now - time < windowMs);
    if (hits.length >= limit) {
      this.#hits.set(key, hits);
      return false;
    }
    hits.push(now);
    this.#hits.set(key, hits);
    return true;
  }

  #maybePrune(now: number, windowMs: number): void {
    if (--this.#callsUntilPrune > 0) return;
    this.#callsUntilPrune = 1000;
    for (const [key, hits] of this.#hits) {
      if (hits.every((time) => now - time >= windowMs)) this.#hits.delete(key);
    }
  }
}
