/**
 * In-memory fixed-window limiter keyed by user id, for expensive per-user operations (chat
 * messages). Complements the global per-IP limit in rate-limit.ts. State is per API instance,
 * which is enough for the single API container.
 */
export class UserRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one request for `key`; returns whether it is allowed and when to retry if not. */
  take(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const now = this.now();
    this.prune(now);
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return { allowed: true };
    }
    if (window.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((window.start + this.windowMs - now) / 1000)),
      };
    }
    window.count += 1;
    return { allowed: true };
  }

  /** Drops expired windows once the map grows, so memory stays bounded. */
  private prune(now: number): void {
    if (this.windows.size < 1000) return;
    for (const [key, window] of this.windows) {
      if (now - window.start >= this.windowMs) this.windows.delete(key);
    }
  }
}
