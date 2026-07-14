export class TokenBucketRateLimiter {
  constructor({ capacity = 50, refillPerSecond = 50, now = () => Date.now() } = {}) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.now = now;
  }

  allow(peer) {
    const current = this.now();
    if (!peer.rateLimit) {
      peer.rateLimit = {
        tokens: this.capacity,
        updatedAt: current
      };
    }

    const elapsedSeconds = Math.max(0, (current - peer.rateLimit.updatedAt) / 1000);
    peer.rateLimit.tokens = Math.min(
      this.capacity,
      peer.rateLimit.tokens + elapsedSeconds * this.refillPerSecond
    );
    peer.rateLimit.updatedAt = current;

    if (peer.rateLimit.tokens < 1) return false;
    peer.rateLimit.tokens -= 1;
    return true;
  }
}
