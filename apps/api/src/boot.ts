import { assertAuthJwtConfig } from './auth/access-jwt.js';
import { serverSecret } from './auth/server-secret.js';
import { loadAvisoConfig } from './consent/aviso-config.js';

/**
 * Fail before the process listens unless the server secret decodes to at
 * least 32 bytes and the configured aviso version has a published row.
 */
export async function prepareBoot(
  env: NodeJS.ProcessEnv,
  avisoPublished: (version: string) => Promise<boolean>,
): Promise<void> {
  serverSecret(env);
  assertAuthJwtConfig(env);
  const { avisoVersion } = loadAvisoConfig(env);
  const published = await avisoPublished(avisoVersion);
  if (!published) {
    throw new Error('AVISO_VERSION is not published.');
  }
}
