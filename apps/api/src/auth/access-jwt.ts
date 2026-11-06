import { createPrivateKey, createPublicKey, createSign, createVerify, generateKeyPairSync } from 'node:crypto';

/** Trust brief §4.2 / §4.6. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const ACCESS_TOKEN_ISS = 'api.duerecord.mx';
export const ACCESS_TOKEN_AUD = 'duerecord-app';
export const ACCESS_TOKEN_SKEW_SECONDS = 60;
/** Raw P-256 signature is r||s, 32 bytes each. */
export const ES256_SIGNATURE_BYTES = 64;
/** NIST P-256 order. A signature with s above half this order is malleable. */
const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P256_HALF_N = P256_N >> 1n;

export interface AuthJwtPublicKey {
  kid: string;
  publicKeyPem: string;
}

export interface AuthJwtConfig extends AuthJwtPublicKey {
  privateKeyPem: string;
}

export interface AuthJwtMaterial {
  current: AuthJwtConfig;
  publicKeys: AuthJwtPublicKey[];
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
export function loadAuthJwt(env: NodeJS.ProcessEnv = process.env): AuthJwtMaterial | null {
  const privateKeyPem = pemFromEnv(env.AUTH_JWT_PRIVATE_KEY);
  const publicKeyPem = pemFromEnv(env.AUTH_JWT_PUBLIC_KEY);
  const kid = env.AUTH_JWT_KID?.trim() || 'primary';
  if (!privateKeyPem && !publicKeyPem && !pemFromEnv(env.AUTH_JWT_PREVIOUS_PUBLIC_KEY)) {
    return null;
  }
  if (!privateKeyPem || !publicKeyPem) {
    throw new Error('AUTH_JWT_PRIVATE_KEY and AUTH_JWT_PUBLIC_KEY must both be set.');
  }
  const current: AuthJwtConfig = { kid, privateKeyPem, publicKeyPem };
  const publicKeys: AuthJwtPublicKey[] = [{ kid, publicKeyPem }];
  const previousPem = pemFromEnv(env.AUTH_JWT_PREVIOUS_PUBLIC_KEY);
  if (previousPem) {
    publicKeys.push({
      kid: env.AUTH_JWT_PREVIOUS_KID?.trim() || `${kid}-previous`,
      publicKeyPem: previousPem,
    });
  }
  return { current, publicKeys };
}

/**
 * Fail boot when a configured key is not P-256 or the private key does not
 * match the public key. Missing keys are allowed; minting then fails closed.
 */
export function assertAuthJwtConfig(env: NodeJS.ProcessEnv = process.env): void {
  const material = loadAuthJwt(env);
  if (!material) {
    return;
  }
  if (new Set(material.publicKeys.map((key) => key.kid)).size !== material.publicKeys.length) {
    throw new Error('AUTH_JWT_PREVIOUS_KID must differ from AUTH_JWT_KID.');
  }
  assertP256Private(material.current.privateKeyPem);
  for (const key of material.publicKeys) {
    assertP256Public(key.publicKeyPem);
  }
  const probe = signAccessToken(material.current, {
    sub: 'boot',
    sid: 'boot',
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
  const verified = verifyAccessToken(material.publicKeys, probe, new Date('2026-01-01T00:00:00.000Z'));
  if (!verified.ok) {
    throw new Error('AUTH_JWT_PRIVATE_KEY does not match AUTH_JWT_PUBLIC_KEY.');
  }
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
  return `${signingInput}.${canonicalizeLowS(Buffer.from(signature)).toString('base64url')}`;
}

/**
 * ES256 only. `none`, `HS256`, and any other alg are rejected before the
 * signature is checked, so a public key cannot be used as an HMAC secret.
 */
export function verifyAccessToken(
  config: AuthJwtPublicKey | readonly AuthJwtPublicKey[],
  token: string,
  now: Date,
): AccessJwtResult {
  const keys = Array.isArray(config) ? config : [config];
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return { ok: false, reason: 'invalid' };
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = decodeJson(encodedHeader);
  if (!header || header.alg !== 'ES256' || typeof header.kid !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  const key = keys.find((item) => item.kid === header.kid);
  if (!key) {
    return { ok: false, reason: 'invalid' };
  }
  if (!/^[A-Za-z0-9_-]{86}$/.test(encodedSignature)) {
    return { ok: false, reason: 'invalid' };
  }
  let signature: Buffer;
  try {
    signature = Buffer.from(encodedSignature, 'base64url');
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (signature.length !== ES256_SIGNATURE_BYTES || !es256LowS(signature)) {
    return { ok: false, reason: 'invalid' };
  }
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  let verified = false;
  try {
    verified = createVerify('SHA256').update(signingInput).verify(
      { key: key.publicKeyPem, dsaEncoding: 'ieee-p1363' },
      signature,
    );
  } catch {
    return { ok: false, reason: 'invalid' };
  }
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

function es256S(signature: Buffer): bigint {
  return BigInt(`0x${signature.subarray(32, 64).toString('hex')}`);
}

/** Rejects the high-S form of an ECDSA signature, which verifies but is malleable. */
export function es256LowS(signature: Buffer): boolean {
  if (signature.length !== ES256_SIGNATURE_BYTES) {
    return false;
  }
  const s = es256S(signature);
  return s > 0n && s <= P256_HALF_N;
}

function canonicalizeLowS(signature: Buffer): Buffer {
  const s = es256S(signature);
  if (s <= P256_HALF_N) {
    return signature;
  }
  const low = (P256_N - s).toString(16).padStart(64, '0');
  const copy = Buffer.from(signature);
  copy.set(Buffer.from(low, 'hex'), 32);
  return copy;
}

function b64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function assertP256Private(pem: string): void {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('AUTH_JWT_PRIVATE_KEY must be a P-256 key.');
  }
}

function assertP256Public(pem: string): void {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('AUTH_JWT public key must be a P-256 key.');
  }
}

function pemFromEnv(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return '';
  }
  return trimmed.includes('\\n') ? trimmed.replaceAll('\\n', '\n') : trimmed;
}
