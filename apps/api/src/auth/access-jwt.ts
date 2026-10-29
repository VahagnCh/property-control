import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';

/** Trust brief §4.2 / §4.6. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const ACCESS_TOKEN_ISS = 'api.duerecord.mx';
export const ACCESS_TOKEN_AUD = 'duerecord-app';
export const ACCESS_TOKEN_SKEW_SECONDS = 60;

export interface AuthJwtConfig {
  kid: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  iat: number;
  exp: number;
  iss: typeof ACCESS_TOKEN_ISS;
  aud: typeof ACCESS_TOKEN_AUD;
}

export type AccessJwtResult =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; reason: 'invalid' | 'expired' };

/** Env only. Missing keys means the process does not mint or accept access tokens. */
export function loadAuthJwt(env: NodeJS.ProcessEnv = process.env): AuthJwtConfig | null {
  const privateKeyPem = pemFromEnv(env.AUTH_JWT_PRIVATE_KEY);
  const publicKeyPem = pemFromEnv(env.AUTH_JWT_PUBLIC_KEY);
  const kid = env.AUTH_JWT_KID?.trim() || 'primary';
  if (!privateKeyPem || !publicKeyPem) {
    return null;
  }
  return { kid, privateKeyPem, publicKeyPem };
}

export function generateAuthJwtKeys(kid = 'test'): AuthJwtConfig {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    kid,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export function signAccessToken(
  config: AuthJwtConfig,
  input: { sub: string; sid: string; now: Date },
): string {
  const iat = Math.floor(input.now.getTime() / 1000);
  const header = { alg: 'ES256', typ: 'JWT', kid: config.kid };
  const payload: AccessTokenClaims = {
    sub: input.sub,
    sid: input.sid,
    iat,
    exp: iat + ACCESS_TOKEN_TTL_SECONDS,
    iss: ACCESS_TOKEN_ISS,
    aud: ACCESS_TOKEN_AUD,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createSign('SHA256').update(signingInput).sign({
    key: config.privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
}

/**
 * ES256 only. `none`, `HS256`, and any other alg are rejected before the
 * signature is checked, so a public key cannot be used as an HMAC secret.
 */
export function verifyAccessToken(
  config: Pick<AuthJwtConfig, 'kid' | 'publicKeyPem'>,
  token: string,
  now: Date,
): AccessJwtResult {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return { ok: false, reason: 'invalid' };
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = decodeJson(encodedHeader);
  if (!header || header.alg !== 'ES256' || header.kid !== config.kid) {
    return { ok: false, reason: 'invalid' };
  }
  const signature = Buffer.from(encodedSignature, 'base64url');
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const verified = createVerify('SHA256').update(signingInput).verify(
    { key: config.publicKeyPem, dsaEncoding: 'ieee-p1363' },
    signature,
  );
  if (!verified) {
    return { ok: false, reason: 'invalid' };
  }
  const payload = decodeJson(encodedPayload);
  if (!isAccessPayload(payload)) {
    return { ok: false, reason: 'invalid' };
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (payload.iat > nowSeconds + ACCESS_TOKEN_SKEW_SECONDS) {
    return { ok: false, reason: 'invalid' };
  }
  if (payload.exp + ACCESS_TOKEN_SKEW_SECONDS < nowSeconds) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, claims: payload };
}

function isAccessPayload(value: unknown): value is AccessTokenClaims {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.sub === 'string' &&
    payload.sub.length > 0 &&
    typeof payload.sid === 'string' &&
    payload.sid.length > 0 &&
    typeof payload.iat === 'number' &&
    typeof payload.exp === 'number' &&
    payload.iss === ACCESS_TOKEN_ISS &&
    payload.aud === ACCESS_TOKEN_AUD &&
    !('email' in payload)
  );
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function b64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function pemFromEnv(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return '';
  }
  return trimmed.includes('\\n') ? trimmed.replaceAll('\\n', '\n') : trimmed;
}
