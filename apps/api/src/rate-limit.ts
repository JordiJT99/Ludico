export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  consume(key: string, limit: number, now: number): { allowed: boolean; retryAfter: number } {
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + 60_000 });
      this.prune(now);
      return { allowed: true, retryAfter: 0 };
    }
    current.count += 1;
    return {
      allowed: current.count <= limit,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }

  private prune(now: number): void {
    if (this.windows.size < 10_000) return;
    for (const [key, value] of this.windows) {
      if (value.resetAt <= now) this.windows.delete(key);
    }
  }
}
