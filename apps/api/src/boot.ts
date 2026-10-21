import { assertRuntimeRole, type RuntimeRole } from './auth/runtime-role.js';
import { serverSecret } from './auth/server-secret.js';
import { loadAvisoConfig } from './consent/aviso-config.js';

/** The web process must not hold the owner URL. Migrations run elsewhere. */
export function assertNoOwnerUrl(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production' && env.DIRECT_URL && env.DIRECT_URL.trim() !== '') {
    throw new Error('DIRECT_URL must not be set on the API process.');
  }
}

export interface BootHooks {
  avisoPublished: (version: string) => Promise<boolean>;
  runtimeRole: () => Promise<RuntimeRole>;
}

/**
 * Fail before the process listens unless the server secret decodes to at
 * least 32 bytes, the connection is property_control_app, and the configured
 * aviso version has a published row.
 */
export async function prepareBoot(env: NodeJS.ProcessEnv, hooks: BootHooks): Promise<void> {
  serverSecret(env);
  assertNoOwnerUrl(env);
  assertRuntimeRole(await hooks.runtimeRole());
  const { avisoVersion } = loadAvisoConfig(env);
  const published = await hooks.avisoPublished(avisoVersion);
  if (!published) {
    throw new Error('AVISO_VERSION is not published.');
  }
}
