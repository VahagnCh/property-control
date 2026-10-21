import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Mutex } from '../persistence/mutex.js';

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  attemptCount: number;
}

export interface AuthAttemptInput {
  subject: string;
  purpose: string;
  success: boolean;
  now: Date;
  limit: number;
  windowMs: number;
}

interface Bucket {
  windowStartedAt: Date;
  attemptCount: number;
  blockedUntil: Date | null;
}

export class MemoryRateLimits {
  private readonly buckets = new Map<string, Bucket>();
  private readonly attempts: AuthAttemptInput[] = [];
  private readonly mutex = new Mutex();

  attemptCount(): number {
    return this.attempts.length;
  }

  record(input: AuthAttemptInput): Promise<RateLimitDecision> {
    return this.mutex.run(async () => {
      this.attempts.push(input);
      return consume(this.buckets, bucketKey(input), input);
    });
  }
}

export class PrismaRateLimits {
  constructor(private readonly prisma: PrismaClient) {}

  async record(input: AuthAttemptInput): Promise<RateLimitDecision> {
    return this.prisma.$transaction(async (tx) => {
      await tx.authCodeAttempt.create({
        data: {
          id: randomUUID(),
          subject: input.subject,
          purpose: input.purpose,
          success: input.success,
          attemptedAt: input.now,
        },
      });
      const key = bucketKey(input);
      const bucketId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO rate_limits (id, bucket_key, window_started_at, attempt_count, updated_at)
        VALUES (CAST(${bucketId} AS uuid), ${key}, ${input.now}, 0, ${input.now})
        ON CONFLICT (bucket_key) DO NOTHING
      `;
      const rows = await tx.$queryRaw<Array<{ window_started_at: Date; attempt_count: number; blocked_until: Date | null }>>`
        SELECT window_started_at, attempt_count, blocked_until
        FROM rate_limits
        WHERE bucket_key = ${key}
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) {
        throw new Error('Rate limit bucket was not inserted.');
      }
      const decision = nextDecision(
        {
          windowStartedAt: row.window_started_at,
          attemptCount: row.attempt_count,
          blockedUntil: row.blocked_until,
        },
        input,
      );
      await tx.rateLimit.update({
        where: { bucketKey: key },
        data: {
          windowStartedAt: decision.bucket.windowStartedAt,
          attemptCount: decision.bucket.attemptCount,
          blockedUntil: decision.bucket.blockedUntil,
        },
      });
      return decision.decision;
    });
  }
}

export function bucketKey(input: { subject: string; purpose: string }): string {
  return `${input.purpose}\u001e${input.subject}`;
}

function consume(buckets: Map<string, Bucket>, key: string, input: AuthAttemptInput): RateLimitDecision {
  const current = buckets.get(key) ?? {
    windowStartedAt: input.now,
    attemptCount: 0,
    blockedUntil: null,
  };
  const decision = nextDecision(current, input);
  buckets.set(key, decision.bucket);
  return decision.decision;
}

function nextDecision(
  current: Bucket,
  input: AuthAttemptInput,
): { decision: RateLimitDecision; bucket: Bucket } {
  if (current.blockedUntil && current.blockedUntil > input.now) {
    return {
      bucket: current,
      decision: {
        allowed: false,
        retryAfterSeconds: retryAfter(current.blockedUntil, input.now),
        attemptCount: current.attemptCount,
      },
    };
  }
  const windowOpen = current.windowStartedAt.getTime() + input.windowMs > input.now.getTime();
  const windowStartedAt = windowOpen ? current.windowStartedAt : input.now;
  const attemptCount = (windowOpen ? current.attemptCount : 0) + 1;
  if (attemptCount > input.limit) {
    const blockedUntil = new Date(windowStartedAt.getTime() + input.windowMs);
    return {
      bucket: { windowStartedAt, attemptCount, blockedUntil },
      decision: {
        allowed: false,
        retryAfterSeconds: retryAfter(blockedUntil, input.now),
        attemptCount,
      },
    };
  }
  return {
    bucket: { windowStartedAt, attemptCount, blockedUntil: null },
    decision: { allowed: true, retryAfterSeconds: 0, attemptCount },
  };
}

function retryAfter(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
}
