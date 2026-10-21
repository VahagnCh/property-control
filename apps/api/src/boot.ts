import { assertRuntimeRole, type RuntimeRole } from './auth/runtime-role.js';
import { serverSecret } from './auth/server-secret.js';
import { loadAvisoConfig } from './consent/aviso-config.js';

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
  assertRuntimeRole(await hooks.runtimeRole());
  const { avisoVersion } = loadAvisoConfig(env);
  const published = await hooks.avisoPublished(avisoVersion);
  if (!published) {
    throw new Error('AVISO_VERSION is not published.');
  }
}
