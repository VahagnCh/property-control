import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Mutex } from '../persistence/mutex.js';
import { keyedHmac } from './server-secret.js';

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

  constructor(private readonly secret: string) {}

  attemptCount(): number {
    return this.attempts.length;
  }

  /** Stored subjects and bucket keys. Tests use this to prove the email is absent. */
  storedText(): string {
    return JSON.stringify({
      subjects: this.attempts.map((attempt) => attempt.subject),
      buckets: [...this.buckets.keys()],
    });
  }

  async resetBucket(input: { subject: string; purpose: string }): Promise<void> {
    return this.mutex.run(async () => {
      const key = bucketKey({ subject: authSubjectHmac(input.subject, this.secret), purpose: input.purpose });
      this.buckets.delete(key);
    });
  }

  async undo(input: AuthAttemptInput): Promise<void> {
    return this.mutex.run(async () => {
      const stored = storedAttempt(input, this.secret);
      const key = bucketKey(stored);
      const bucket = this.buckets.get(key);
      if (bucket) {
        const attemptCount = Math.max(0, bucket.attemptCount - 1);
        this.buckets.set(key, {
          windowStartedAt: bucket.windowStartedAt,
          attemptCount,
          blockedUntil: attemptCount > input.limit ? bucket.blockedUntil : null,
        });
      }
      const index = this.attempts.findLastIndex(
        (attempt) => attempt.subject === stored.subject && attempt.purpose === stored.purpose,
      );
      if (index >= 0) {
        this.attempts.splice(index, 1);
      }
    });
  }

  record(input: AuthAttemptInput): Promise<RateLimitDecision> {
    return this.mutex.run(async () => {
      const stored = storedAttempt(input, this.secret);
      this.attempts.push(stored);
      return consume(this.buckets, bucketKey(stored), stored);
    });
  }

  /** Seconds until the bucket opens, or null when the next attempt may proceed. */
  retryIfBlocked(input: { subject: string; purpose: string; now: Date }): Promise<number | null> {
    return this.mutex.run(async () => {
      const key = bucketKey({ subject: authSubjectHmac(input.subject, this.secret), purpose: input.purpose });
      const bucket = this.buckets.get(key);
      if (!bucket?.blockedUntil || bucket.blockedUntil <= input.now) {
        return null;
      }
      return Math.max(1, Math.ceil((bucket.blockedUntil.getTime() - input.now.getTime()) / 1000));
    });
  }
}

export class PrismaRateLimits {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly secret: string,
  ) {}

  async retryIfBlocked(input: { subject: string; purpose: string; now: Date }): Promise<number | null> {
    const key = bucketKey({ subject: authSubjectHmac(input.subject, this.secret), purpose: input.purpose });
    const row = await this.prisma.rateLimit.findUnique({ where: { bucketKey: key } });
    if (!row?.blockedUntil || row.blockedUntil <= input.now) {
      return null;
    }
    return Math.max(1, Math.ceil((row.blockedUntil.getTime() - input.now.getTime()) / 1000));
  }

  async resetBucket(input: { subject: string; purpose: string }): Promise<void> {
    const key = bucketKey({ subject: authSubjectHmac(input.subject, this.secret), purpose: input.purpose });
    await this.prisma.rateLimit.deleteMany({ where: { bucketKey: key } });
  }

  async undo(input: AuthAttemptInput): Promise<void> {
    const stored = storedAttempt(input, this.secret);
    const key = bucketKey(stored);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE rate_limits
        SET attempt_count = GREATEST(attempt_count - 1, 0),
            blocked_until = CASE WHEN attempt_count - 1 > ${input.limit} THEN blocked_until ELSE NULL END
        WHERE bucket_key = ${key}
      `;
      await tx.$executeRaw`
        DELETE FROM auth_code_attempts
        WHERE id = (
          SELECT id FROM auth_code_attempts
          WHERE subject = ${stored.subject} AND purpose = ${stored.purpose}
          ORDER BY attempted_at DESC
          LIMIT 1
        )
      `;
    });
  }

  async record(input: AuthAttemptInput): Promise<RateLimitDecision> {
    const stored = storedAttempt(input, this.secret);
    return this.prisma.$transaction(async (tx) => {
      await tx.authCodeAttempt.create({
        data: {
          id: randomUUID(),
          subject: stored.subject,
          purpose: stored.purpose,
          success: stored.success,
          attemptedAt: stored.now,
        },
      });
      const key = bucketKey(stored);
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
        stored,
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

export const AUTH_RATE = Symbol('AUTH_RATE');

export function authSubjectHmac(subject: string, secret: string): string {
  return keyedHmac(subject, secret, 'auth-subject');
}

export function bucketKey(input: { subject: string; purpose: string }): string {
  return `${input.purpose}\u001e${input.subject}`;
}

function storedAttempt(input: AuthAttemptInput, secret: string): AuthAttemptInput {
  return { ...input, subject: authSubjectHmac(input.subject, secret) };
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
