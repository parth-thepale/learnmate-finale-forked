/**
 * Bounded in-memory fixed-window rate limiter.
 *
 * This protects a single server process against bursts. It is NOT durable: counters reset on
 * restart and are not shared between instances. Durable daily limits live in the quota store.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface FixedWindowRateLimiterOptions {
  windowMs: number;
  max: number;
  maxKeys?: number;
  now?: () => number;
}

export class FixedWindowRateLimiter {
  private readonly windowMs: number;
  private readonly max: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(options: FixedWindowRateLimiterOptions) {
    if (!(options.windowMs > 0) || !(options.max > 0)) {
      throw new Error('FixedWindowRateLimiter requires positive windowMs and max.');
    }
    this.windowMs = options.windowMs;
    this.max = Math.floor(options.max);
    this.maxKeys = options.maxKeys ?? 50_000;
    this.now = options.now ?? Date.now;
  }

  hit(key: string): RateLimitResult {
    const now = this.now();
    let entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      if (!entry && this.windows.size >= this.maxKeys) {
        this.evict(now);
      }
      entry = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, entry);
    }

    if (entry.count >= this.max) {
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, entry.resetAt - now) };
    }

    entry.count += 1;
    return { allowed: true, remaining: this.max - entry.count, retryAfterMs: 0 };
  }

  get size(): number {
    return this.windows.size;
  }

  private evict(now: number): void {
    for (const [key, entry] of this.windows) {
      if (entry.resetAt <= now) this.windows.delete(key);
    }
    // Still full: drop the oldest insertions so memory stays bounded.
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
  }
}
