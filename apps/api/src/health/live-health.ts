/** Burst of 30, refilled at 30 per minute. One bucket per process. */
export const HEALTH_LIMIT_TOKENS = 30;
export const HEALTH_LIMIT_WINDOW_MS = 60_000;
/** Cap on remembered client IPs. The least recently used bucket is dropped. */
export const HEALTH_LIMIT_MAX_BUCKETS = 1024;
/** Short enough to fail a stuck connection, long enough for a cold database to answer. */
export const HEALTH_DB_TIMEOUT_MS = 2_000;

export interface HealthProbe {
  ping(): Promise<void>;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface HealthLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * In-process token bucket for GET /v1/health only.
 * It is not shared across instances and it is not used for other routes.
 */
export class HealthRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly perMs: number;
  private readonly maxBuckets: number;

  constructor(
    capacity = HEALTH_LIMIT_TOKENS,
    windowMs = HEALTH_LIMIT_WINDOW_MS,
    maxBuckets = HEALTH_LIMIT_MAX_BUCKETS,
  ) {
    this.capacity = capacity;
    this.perMs = capacity / windowMs;
    this.maxBuckets = maxBuckets;
  }

  /** Insertion order is least-recently-used first. */
  snapshot(): string[] {
    return [...this.buckets.keys()];
  }

  consume(ip: string, now = Date.now()): HealthLimitDecision {
    const existing = this.buckets.get(ip);
    if (existing) {
      this.buckets.delete(ip);
    } else if (this.buckets.size >= this.maxBuckets) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) {
        this.buckets.delete(oldest);
      }
    }
    const current = existing ?? { tokens: this.capacity, updatedAt: now };
    const elapsed = Math.max(0, now - current.updatedAt);
    const tokens = Math.min(this.capacity, current.tokens + elapsed * this.perMs);
    if (tokens < 1) {
      const retryAfterSeconds = Math.max(1, Math.ceil((1 - tokens) / this.perMs / 1000));
      this.buckets.set(ip, { tokens, updatedAt: now });
      return { allowed: false, retryAfterSeconds };
    }
    this.buckets.set(ip, { tokens: tokens - 1, updatedAt: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export async function pingDatabase(query: () => Promise<unknown>, timeoutMs = HEALTH_DB_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('health timeout')), timeoutMs);
  });
  try {
    await Promise.race([query(), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
