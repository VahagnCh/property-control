import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Optional, Inject } from '@nestjs/common';
import { signAccessToken, type AuthJwtConfig } from './access-jwt.js';
import { AUTH_EMAIL, FakeAuthEmailSender, type AuthEmailSender } from './auth-email.js';
import {
  AUTH_ACCEPTED_BODY,
  AUTH_CODE_STORE,
  CODE_TTL_MS,
  MemoryAuthCodes,
  RESEND_COOLDOWN_MS,
  VERIFY_FAILURES_BEFORE_LIMIT,
  authCodeHmac,
  authCodesMatch,
  normalizeAuthEmail,
  randomAuthCode,
  type AuthCodeStore,
} from './auth-codes.js';
import { MemoryIdempotencyKeys, assertIdempotencyKey } from './idempotency-keys.js';
import { MemoryRateLimits } from './rate-limit.js';
import { MemoryRefreshTokens } from './refresh-tokens.js';
import { keyedHmac, serverSecret } from './server-secret.js';
import { AUTH_CLOCK, AUTH_JWT, SESSION_DIRECTORY, type SessionDirectory } from './session-directory.js';

const CODE_ROUTE = 'POST /v1/auth/code';
const EMAIL_SEND_LIMIT = 5;
const EMAIL_SEND_WINDOW_MS = 60 * 60 * 1000;
const IP_SEND_LIMIT = 5;
const VERIFY_WINDOW_MS = CODE_TTL_MS;

export interface AuthHttpResult {
  status: number;
  body: Record<string, unknown> | null;
  retryAfterSeconds?: number;
}

interface AuthUser {
  id: string;
}

export class MemoryAuthUsers {
  private readonly byHmac = new Map<string, AuthUser>();

  findByEmailHmac(emailHmac: string): Promise<AuthUser | null> {
    return Promise.resolve(this.byHmac.get(emailHmac) ?? null);
  }

  create(emailHmac: string): Promise<AuthUser> {
    const existing = this.byHmac.get(emailHmac);
    if (existing) {
      return Promise.resolve(existing);
    }
    const user = { id: randomUUID() };
    this.byHmac.set(emailHmac, user);
    return Promise.resolve(user);
  }
}

@Injectable()
export class AuthService {
  private readonly codes: AuthCodeStore;
  private readonly sender: AuthEmailSender;
  private readonly users = new MemoryAuthUsers();
  private readonly idempotency = new MemoryIdempotencyKeys();
  private refreshTokens: MemoryRefreshTokens | null = null;
  private rateLimits: MemoryRateLimits | null = null;
  private readonly dummyCodeHmac: string;

  constructor(
    @Inject(SESSION_DIRECTORY) private readonly sessions: SessionDirectory,
    @Optional() @Inject(AUTH_EMAIL) sender?: AuthEmailSender,
    @Optional() @Inject(AUTH_CODE_STORE) codes?: AuthCodeStore,
    @Optional() @Inject(AUTH_JWT) private readonly jwt: AuthJwtConfig | null = null,
    @Optional() @Inject(AUTH_CLOCK) clock?: () => Date,
  ) {
    this.sender = sender ?? new FakeAuthEmailSender();
    this.codes = codes ?? new MemoryAuthCodes();
    this.clock = clock ?? (() => new Date());
    this.dummyCodeHmac = authCodeHmac('000000', 'dummy-pepper');
  }

  private readonly clock: () => Date;

  async requestCode(input: { email: unknown; idempotencyKey?: string; ip: string }): Promise<AuthHttpResult> {
    if (typeof input.email !== 'string') {
      return errorResult(400, 'auth.email_invalid', 'Email is required.');
    }
    const email = normalizeAuthEmail(input.email);
    if (email.length < 3 || email.length > 320 || !email.includes('@')) {
      return errorResult(400, 'auth.email_invalid', 'Email is required.');
    }
    const now = this.clock();
    const emailHmac = keyedHmac(email, this.secret(), 'auth-email');
    const reserved = await this.reserveCodeRequest(emailHmac, input.idempotencyKey, now);
    if (reserved.kind === 'done') {
      return reserved.result;
    }
    const latest = await this.codes.findLatest(emailHmac);
    if (latest && now.getTime() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      return this.finish(reserved.id, accepted());
    }
    const limited = await this.limitSends(emailHmac, input.ip, now);
    if (limited) {
      return this.finish(reserved.id, limited);
    }
    const code = randomAuthCode();
    await this.codes.invalidateActive(emailHmac, now);
    await this.codes.insert({
      id: randomUUID(),
      emailHmac,
      codeHmac: authCodeHmac(code, this.secret()),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      usedAt: null,
      attempts: 0,
      createdAt: now,
    });
    await this.sender.sendLoginCode({ to: email, code });
    return this.finish(reserved.id, accepted());
  }

  async verifyCode(input: { email: unknown; code: unknown; ip: string }): Promise<AuthHttpResult> {
    if (typeof input.email !== 'string' || typeof input.code !== 'string') {
      return errorResult(401, 'auth.code_invalid', 'The code is not valid.');
    }
    const email = normalizeAuthEmail(input.email);
    const now = this.clock();
    const emailHmac = keyedHmac(email, this.secret(), 'auth-email');
    const blockedFor = await this.limits().retryIfBlocked({
      subject: emailHmac,
      purpose: 'auth.verify',
      now,
    });
    if (blockedFor !== null) {
      return rateLimited(blockedFor);
    }
    const row = await this.codes.findLatest(emailHmac);
    const presented = authCodeHmac(input.code, this.secret());
    const stored = row?.codeHmac ?? this.dummyCodeHmac;
    const hmacOk = authCodesMatch(presented, stored);
    const live = Boolean(row && !row.usedAt && row.expiresAt > now && row.attempts < VERIFY_FAILURES_BEFORE_LIMIT);
    if (!live || !hmacOk || !row) {
      if (row && !row.usedAt && row.expiresAt > now) {
        await this.codes.recordFailure(row.id);
      }
      const decision = await this.limits().record({
        subject: emailHmac,
        purpose: 'auth.verify',
        success: false,
        now,
        limit: VERIFY_FAILURES_BEFORE_LIMIT - 1,
        windowMs: VERIFY_WINDOW_MS,
      });
      if (!decision.allowed) {
        return rateLimited(decision.retryAfterSeconds);
      }
      return errorResult(401, 'auth.code_invalid', 'The code is not valid.');
    }
    if (!this.jwt) {
      return errorResult(503, 'auth.unavailable', 'Access tokens are not configured.');
    }
    await this.codes.markUsed(row.id, now);
    const user = (await this.users.findByEmailHmac(emailHmac)) ?? (await this.users.create(emailHmac));
    return this.issuePair(user.id, now);
  }

  async refresh(input: { refreshToken: unknown }): Promise<AuthHttpResult> {
    if (typeof input.refreshToken !== 'string' || input.refreshToken.length === 0 || !this.jwt) {
      return errorResult(401, 'auth.refresh_invalid', 'The refresh token is not valid.');
    }
    const now = this.clock();
    const nextRaw = newRefreshToken();
    const result = await this.tokens().rotate({ rawToken: input.refreshToken, now, nextRawToken: nextRaw });
    if (result.outcome === 'rotated' || result.outcome === 'grace') {
      return this.pair(result.token.userId, result.token.familyId, result.refreshToken, now);
    }
    if (result.outcome === 'reused') {
      this.sessions.revoke(result.familyId);
      return errorResult(401, 'auth.refresh_reused', 'The session was revoked.');
    }
    return errorResult(401, 'auth.refresh_invalid', 'The refresh token is not valid.');
  }

  async logout(sid: string | undefined): Promise<AuthHttpResult> {
    if (!sid) {
      return errorResult(401, 'token_invalid', 'Invalid access token.');
    }
    const now = this.clock();
    this.sessions.revoke(sid);
    await this.tokens().revokeFamily(sid, now);
    return { status: 204, body: null };
  }

  private async issuePair(userId: string, now: Date): Promise<AuthHttpResult> {
    const refreshToken = newRefreshToken();
    const issued = await this.tokens().issue({ userId, rawToken: refreshToken, now });
    return this.pair(userId, issued.familyId, refreshToken, now);
  }

  private pair(userId: string, sid: string, refreshToken: string, now: Date): AuthHttpResult {
    if (!this.jwt) {
      return errorResult(503, 'auth.unavailable', 'Access tokens are not configured.');
    }
    const accessToken = signAccessToken(this.jwt, { sub: userId, sid, now });
    return {
      status: 200,
      body: {
        tokenType: 'Bearer',
        accessToken,
        expiresIn: 15 * 60,
        refreshToken,
      },
    };
  }

  private async reserveCodeRequest(
    emailHmac: string,
    idempotencyKey: string | undefined,
    now: Date,
  ): Promise<{ kind: 'continue'; id: string | null } | { kind: 'done'; result: AuthHttpResult }> {
    if (!idempotencyKey) {
      return { kind: 'continue', id: null };
    }
    try {
      assertIdempotencyKey(idempotencyKey);
    } catch (error) {
      const response = error as { getResponse?: () => unknown };
      const body = response.getResponse?.();
      if (body && typeof body === 'object') {
        return { kind: 'done', result: { status: 400, body: body as Record<string, unknown> } };
      }
      return { kind: 'done', result: errorResult(400, 'idempotency_key_invalid', 'Idempotency-Key is invalid.') };
    }
    const reserved = await this.idempotency.reserve({
      emailHmac,
      key: idempotencyKey,
      method: 'POST',
      route: CODE_ROUTE,
      requestHash: createHash('sha256').update(emailHmac).digest('hex'),
      now,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    });
    if (reserved.outcome === 'replay') {
      return {
        kind: 'done',
        result: { status: reserved.responseStatus, body: asBody(reserved.responseBody) },
      };
    }
    if (reserved.outcome === 'in_progress') {
      return { kind: 'done', result: accepted() };
    }
    return { kind: 'continue', id: reserved.id };
  }

  private async finish(id: string | null, result: AuthHttpResult): Promise<AuthHttpResult> {
    if (id && result.body) {
      await this.idempotency.complete(id, result.status, result.body);
    }
    return result;
  }

  private async limitSends(emailHmac: string, ip: string, now: Date): Promise<AuthHttpResult | null> {
    const email = await this.limits().record({
      subject: emailHmac,
      purpose: 'auth.code.email',
      success: true,
      now,
      limit: EMAIL_SEND_LIMIT,
      windowMs: EMAIL_SEND_WINDOW_MS,
    });
    if (!email.allowed) {
      return rateLimited(email.retryAfterSeconds);
    }
    const address = await this.limits().record({
      subject: ip || 'unknown',
      purpose: 'auth.code.ip',
      success: true,
      now,
      limit: IP_SEND_LIMIT,
      windowMs: EMAIL_SEND_WINDOW_MS,
    });
    if (!address.allowed) {
      return rateLimited(address.retryAfterSeconds);
    }
    return null;
  }

  private secret(): string {
    return serverSecret();
  }

  private limits(): MemoryRateLimits {
    this.rateLimits ??= new MemoryRateLimits(this.secret());
    return this.rateLimits;
  }

  private tokens(): MemoryRefreshTokens {
    this.refreshTokens ??= new MemoryRefreshTokens(this.secret());
    return this.refreshTokens;
  }
}

function accepted(): AuthHttpResult {
  return { status: 202, body: { ...AUTH_ACCEPTED_BODY } };
}

function rateLimited(retryAfterSeconds: number): AuthHttpResult {
  return {
    status: 429,
    retryAfterSeconds,
    body: { statusCode: 429, error: 'auth.rate_limited', message: 'Too many attempts.' },
  };
}

function errorResult(status: number, error: string, message: string): AuthHttpResult {
  return { status, body: { statusCode: status, error, message } };
}

function asBody(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function newRefreshToken(): string {
  return `rt_${randomBytes(32).toString('base64url')}`;
}
