import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Optional, Inject } from '@nestjs/common';
import { signAccessToken, type AuthJwtConfig } from './access-jwt.js';
import { AUTH_EMAIL, FakeAuthEmailSender, authEmailAllowList, type AuthEmailSender } from './auth-email.js';
import {
  AUTH_ACCEPTED_BODY,
  AUTH_CODE_STORE,
  CODE_TTL_MS,
  MemoryAuthCodes,
  RESEND_COOLDOWN_MS,
  VERIFY_EMAIL_IP_LIMIT,
  VERIFY_FAILURES_BEFORE_LIMIT,
  authCodeCompare,
  authCodeHmac,
  normalizeAuthEmail,
  randomAuthCode,
  type AuthCodeStore,
} from './auth-codes.js';
import { AUTH_AUDIT, MemoryAuthAudit, type AuthAuditLog } from './auth-audit.js';
import { MemoryIdempotencyKeys, assertIdempotencyKey, type IdempotencyStore } from './idempotency-keys.js';
import { AUTH_RATE, MemoryRateLimits, type RateLimitDecision } from './rate-limit.js';
import { MemoryRefreshTokens, type RefreshTokenRow, type RotateResult } from './refresh-tokens.js';
import { keyedHmac, serverSecret } from './server-secret.js';
import {
  AUTH_CLOCK,
  AUTH_JWT,
  AUTH_LIMITS,
  AUTH_USERS,
  AUTH_REFRESH,
  SESSION_DIRECTORY,
  authLimitsFromEnv,
  type AuthLimits,
  type SessionDirectory,
} from './session-directory.js';

const CODE_ROUTE = 'POST /v1/auth/code';
const VERIFY_WINDOW_MS = CODE_TTL_MS;
export const AUTH_IDEMPOTENCY = Symbol('AUTH_IDEMPOTENCY');

interface RefreshStore {
  issue(input: { userId: string; rawToken: string; now: Date }): Promise<RefreshTokenRow>;
  rotate(input: { rawToken: string; now: Date; nextRawToken: string }): Promise<RotateResult>;
  revokeFamily(familyId: string, now: Date): Promise<void>;
}

export interface AuthUsers {
  findOrCreate(emailHmac: string): Promise<{ id: string }>;
}

export interface AuthHttpResult {
  status: number;
  body: Record<string, unknown> | null;
  retryAfterSeconds?: number;
}

interface AuthUser {
  id: string;
}

export class MemoryAuthUsers implements AuthUsers {
  private readonly byHmac = new Map<string, AuthUser>();

  findOrCreate(emailHmac: string): Promise<AuthUser> {
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
  private readonly users: AuthUsers;
  private readonly idempotency: IdempotencyStore;
  private readonly limitsConfig: AuthLimits;
  private readonly audit: AuthAuditLog;
  private refreshTokens: RefreshStore | null = null;
  private rateLimits: RateStore | null = null;
  private readonly clock: () => Date;

  constructor(
    @Inject(SESSION_DIRECTORY) private readonly sessions: SessionDirectory,
    @Optional() @Inject(AUTH_EMAIL) sender?: AuthEmailSender,
    @Optional() @Inject(AUTH_CODE_STORE) codes?: AuthCodeStore,
    @Optional() @Inject(AUTH_JWT) private readonly jwt: AuthJwtConfig | null = null,
    @Optional() @Inject(AUTH_CLOCK) clock?: () => Date,
    @Optional() @Inject(AUTH_LIMITS) limits?: AuthLimits,
    @Optional() @Inject(AUTH_USERS) users?: AuthUsers,
    @Optional() @Inject(AUTH_REFRESH) refreshTokens?: RefreshStore,
    @Optional() @Inject(AUTH_AUDIT) audit?: AuthAuditLog,
    @Optional() @Inject(AUTH_RATE) rates?: RateStore | null,
    @Optional() @Inject(AUTH_IDEMPOTENCY) idempotency?: IdempotencyStore,
  ) {
    this.sender = sender ?? new FakeAuthEmailSender();
    this.codes = codes ?? new MemoryAuthCodes();
    this.clock = clock ?? (() => new Date());
    this.limitsConfig = limits ?? authLimitsFromEnv();
    this.users = users ?? new MemoryAuthUsers();
    this.refreshTokens = refreshTokens ?? null;
    this.rateLimits = rates ?? null;
    this.audit = audit ?? new MemoryAuthAudit();
    this.idempotency = idempotency ?? new MemoryIdempotencyKeys();
  }

  async requestCode(input: { email: unknown; idempotencyKey?: string; ip: string }): Promise<AuthHttpResult> {
    if (typeof input.email !== 'string') {
      return errorResult(400, 'auth.email_invalid', 'Email is required.');
    }
    const email = normalizeAuthEmail(input.email);
    if (email.length < 3 || email.length > 320 || !email.includes('@')) {
      return errorResult(400, 'auth.email_invalid', 'Email is required.');
    }
    if (!this.sender.configured) {
      return errorResult(503, 'auth.unavailable', 'Login email is not configured.');
    }
    const allowList = authEmailAllowList();
    if (allowList && !allowList.has(email)) {
      return accepted();
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
    const rowId = randomUUID();
    await this.codes.invalidateActive(emailHmac, now);
    await this.codes.insert({
      id: rowId,
      emailHmac,
      codeHmac: authCodeHmac(code, this.secret()),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      usedAt: null,
      attempts: 0,
      createdAt: now,
    });
    try {
      await this.sender.sendLoginCode({ to: email, code });
    } catch {
      await this.codes.deleteById(rowId);
      await this.undoSends(emailHmac, input.ip, now);
      return this.finish(reserved.id, errorResult(503, 'auth.unavailable', 'Login email is not configured.'));
    }
    await this.limits().resetBucket({ subject: emailHmac, purpose: 'auth.verify' });
    return this.finish(reserved.id, accepted());
  }

  async verifyCode(input: { email: unknown; code: unknown; ip: string }): Promise<AuthHttpResult> {
    if (typeof input.email !== 'string' || typeof input.code !== 'string') {
      return errorResult(401, 'auth.code_invalid', 'The code is not valid.');
    }
    const email = normalizeAuthEmail(input.email);
    const now = this.clock();
    const emailHmac = keyedHmac(email, this.secret(), 'auth-email');
    const ipDecision = await this.limits().record({
      subject: input.ip || 'unknown',
      purpose: 'auth.verify.ip',
      success: false,
      now,
      limit: this.limitsConfig.verifyIpLimit,
      windowMs: this.limitsConfig.windowMs,
    });
    if (!ipDecision.allowed) {
      return rateLimited(ipDecision.retryAfterSeconds);
    }
    if (!this.jwt) {
      return errorResult(503, 'auth.unavailable', 'Access tokens are not configured.');
    }
    const perAddress = await this.limits().record({
      subject: `${emailHmac}\u001e${input.ip || 'unknown'}`,
      purpose: 'auth.verify.email_ip',
      success: false,
      now,
      limit: VERIFY_EMAIL_IP_LIMIT,
      windowMs: VERIFY_WINDOW_MS,
    });
    if (!perAddress.allowed) {
      return rateLimited(perAddress.retryAfterSeconds);
    }
    const emailDecision = await this.limits().record({
      subject: emailHmac,
      purpose: 'auth.verify',
      success: false,
      now,
      limit: VERIFY_FAILURES_BEFORE_LIMIT - 1,
      windowMs: VERIFY_WINDOW_MS,
    });
    if (!emailDecision.allowed) {
      return rateLimited(emailDecision.retryAfterSeconds);
    }
    if (!/^\d{6}$/.test(input.code)) {
      return errorResult(401, 'auth.code_invalid', 'The code is not valid.');
    }
    const reservedAttempt = await this.codes.reserveAttempt(emailHmac, now);
    if (!reservedAttempt) {
      return errorResult(401, 'auth.code_invalid', 'The code is not valid.');
    }
    const presented = authCodeHmac(input.code, this.secret());
    if (!authCodeCompare.authCodesMatch(presented, reservedAttempt.codeHmac)) {
      await this.audit.append({
        action: 'auth.login.failed',
        userId: null,
        sessionId: null,
        emailHmac,
        now,
      });
      return errorResult(401, 'auth.code_invalid', 'The code is not valid.');
    }
    const claimed = await this.codes.claimUnused(reservedAttempt.id, now);
    if (!claimed) {
      return errorResult(401, 'auth.code_invalid', 'The code is not valid.');
    }
    const user = await this.users.findOrCreate(emailHmac);
    const issued = await this.issuePair(user.id, now);
    await this.audit.append({
      action: 'auth.login.succeeded',
      userId: user.id,
      sessionId: issued.sessionId,
      emailHmac,
      now,
    });
    return issued.result;
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
      await this.sessions.revoke(result.familyId, now);
      await this.audit.append({
        action: 'auth.refresh.reuse_detected',
        userId: null,
        sessionId: result.familyId,
        emailHmac: null,
        now,
      });
      return errorResult(401, 'auth.refresh_reused', 'The session was revoked.');
    }
    return errorResult(401, 'auth.refresh_invalid', 'The refresh token is not valid.');
  }

  async logout(sid: string | undefined, userId?: string | null): Promise<AuthHttpResult> {
    if (!sid) {
      return errorResult(401, 'token_invalid', 'Invalid access token.');
    }
    const now = this.clock();
    await this.sessions.revoke(sid, now);
    await this.tokens().revokeFamily(sid, now);
    await this.audit.append({
      action: 'auth.logout',
      userId: userId ?? null,
      sessionId: sid,
      emailHmac: null,
      now,
    });
    return { status: 204, body: null };
  }

  private async issuePair(userId: string, now: Date): Promise<{ result: AuthHttpResult; sessionId: string }> {
    const refreshToken = newRefreshToken();
    const issued = await this.tokens().issue({ userId, rawToken: refreshToken, now });
    await this.sessions.open(issued.familyId, userId);
    return { result: this.pair(userId, issued.familyId, refreshToken, now), sessionId: issued.familyId };
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
    const address = await this.limits().record({
      subject: ip || 'unknown',
      purpose: 'auth.code.ip',
      success: true,
      now,
      limit: this.limitsConfig.ipSendLimit,
      windowMs: this.limitsConfig.windowMs,
    });
    if (!address.allowed) {
      return rateLimited(address.retryAfterSeconds);
    }
    const email = await this.limits().record({
      subject: emailHmac,
      purpose: 'auth.code.email',
      success: true,
      now,
      limit: this.limitsConfig.emailSendLimit,
      windowMs: this.limitsConfig.windowMs,
    });
    if (!email.allowed) {
      return rateLimited(email.retryAfterSeconds);
    }
    return null;
  }

  private async undoSends(emailHmac: string, ip: string, now: Date): Promise<void> {
    const windowMs = this.limitsConfig.windowMs;
    await this.limits().undo({
      subject: emailHmac,
      purpose: 'auth.code.email',
      success: true,
      now,
      limit: this.limitsConfig.emailSendLimit,
      windowMs,
    });
    await this.limits().undo({
      subject: ip || 'unknown',
      purpose: 'auth.code.ip',
      success: true,
      now,
      limit: this.limitsConfig.ipSendLimit,
      windowMs,
    });
  }

  private secret(): string {
    return serverSecret();
  }

  private limits(): RateStore {
    if (this.rateLimits) {
      return this.rateLimits;
    }
    const created = new MemoryRateLimits(this.secret());
    this.rateLimits = created;
    return created;
  }

  private tokens(): RefreshStore {
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

interface RateStore {
  record(input: {
    subject: string;
    purpose: string;
    success: boolean;
    now: Date;
    limit: number;
    windowMs: number;
  }): Promise<RateLimitDecision>;
  retryIfBlocked(input: { subject: string; purpose: string; now: Date }): Promise<number | null>;
  resetBucket(input: { subject: string; purpose: string }): Promise<void>;
  undo(input: {
    subject: string;
    purpose: string;
    success: boolean;
    now: Date;
    limit: number;
    windowMs: number;
  }): Promise<void>;
}

function newRefreshToken(): string {
  return `rt_${randomBytes(32).toString('base64url')}`;
}
