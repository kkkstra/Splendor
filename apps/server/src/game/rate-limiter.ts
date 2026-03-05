export class SlidingWindowLimiter {
  private readonly windows = new Map<string, number[]>();

  allow(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const current = this.windows.get(key) ?? [];
    const next = current.filter((ts) => ts > now - windowMs);

    if (next.length >= limit) {
      this.windows.set(key, next);
      return false;
    }

    next.push(now);
    this.windows.set(key, next);
    return true;
  }
}
