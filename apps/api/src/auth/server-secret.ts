import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Boot secret. The value is base64 or base64url and must decode to at least
 * 32 bytes. The returned string is the trimmed input. Errors never include it.
 */
export function serverSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.SERVER_SECRET?.trim() ?? '';
  if (secret.length === 0) {
    throw new Error('SERVER_SECRET is required.');
  }
  const decoded = decodeSecret(secret);
  if (decoded === null || decoded.length < 32) {
    throw new Error('SERVER_SECRET must decode to at least 32 bytes.');
  }
  return secret;
}

function decodeSecret(secret: string): Buffer | null {
  const stripped = secret.replace(/=+$/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (stripped.length === 0 || !/^[A-Za-z0-9+/]+$/.test(stripped) || stripped.length % 4 === 1) {
    return null;
  }
  const padded = stripped + '='.repeat((4 - (stripped.length % 4)) % 4);
  const bytes = Buffer.from(padded, 'base64');
  if (bytes.toString('base64').replace(/=+$/g, '') !== stripped) {
    return null;
  }
  return bytes;
}

/** Keyed HMAC. The stored value is hex, never the plain email. */
export function keyedHmac(value: string, secret: string, purpose: string): string {
  const normalized = value.normalize('NFC').trim().toLowerCase();
  return createHmac('sha256', secret).update(`${purpose}\u001e${normalized}`).digest('hex');
}

/**
 * AES-256-GCM. The result is `v1.<iv>.<tag>.<ciphertext>` and does not
 * contain the plaintext. The key is derived from the server secret and is
 * not logged.
 */
export function sealString(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function openSealed(sealed: string, secret: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) {
    throw new Error('sealed value is not readable');
  }
  const decipher = createDecipheriv('aes-256-gcm', aesKey(secret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

function aesKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('property-control-seal').digest();
}
