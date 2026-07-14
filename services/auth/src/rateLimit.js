export class IpRateLimiter {
  constructor({ capacity = 30, refillPerMinute = 30, now = () => Date.now() } = {}) {
    this.capacity = capacity;
    this.refillPerMinute = refillPerMinute;
    this.now = now;
    this.buckets = new Map();
  }

  allow(key) {
    const current = this.now();
    const bucket = this.buckets.get(key) || {
      tokens: this.capacity,
      updatedAt: current
    };

    const elapsedMinutes = Math.max(0, (current - bucket.updatedAt) / 60_000);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedMinutes * this.refillPerMinute);
    bucket.updatedAt = current;

    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return false;
    }

    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }
}
