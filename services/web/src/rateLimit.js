export class IpRateLimiter {
  constructor({ capacity = 20, refillPerSecond = 0.5, now = () => Date.now() } = {}) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.now = now;
    this.buckets = new Map();
  }

  allow(key) {
    const now = this.now();
    const previous = this.buckets.get(key) || { tokens: this.capacity, updatedAt: now };
    const elapsed = Math.max(0, now - previous.updatedAt) / 1000;
    const tokens = Math.min(this.capacity, previous.tokens + elapsed * this.refillPerSecond);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedAt: now });
      return false;
    }
    this.buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    if (this.buckets.size > 10_000) this.prune(now);
    return true;
  }

  prune(now = this.now()) {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > 60 * 60 * 1000) this.buckets.delete(key);
    }
  }
}
