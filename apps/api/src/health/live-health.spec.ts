import { describe, expect, it } from 'vitest';
import { HealthRateLimiter, pingDatabase } from './live-health.js';

describe('health limiter and database timeout', () => {
  it('allows 30 calls and then asks the caller to wait', () => {
    const limiter = new HealthRateLimiter(30, 60_000);
    const now = Date.parse('2026-10-21T18:00:00.000Z');
    for (let i = 0; i < 30; i += 1) {
      expect(limiter.consume('203.0.113.5', now).allowed).toBe(true);
    }
    const blocked = limiter.consume('203.0.113.5', now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(limiter.consume('203.0.113.9', now).allowed).toBe(true);
  });

  it('rejects a query that does not finish within the timeout', async () => {
    await expect(pingDatabase(() => new Promise(() => undefined), 15)).rejects.toThrow(/health timeout/);
  });
});
