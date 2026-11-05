import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/**
 * PostgreSQL SCRAM-SHA-256 verifier. ASCII passwords skip SASLprep.
 * The result is safe to send in CREATE ROLE; it is not the password.
 */
export function scramSha256Password(password, iterations = 4096) {
  if (typeof password !== 'string' || password.trim() === '' || password !== password.trim()) {
    throw new Error('APP_ROLE_PASSWORD is required');
  }
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  const b64 = (buf) => buf.toString('base64');
  return `SCRAM-SHA-256$${iterations}:${b64(salt)}$${b64(storedKey)}:${b64(serverKey)}`;
}
