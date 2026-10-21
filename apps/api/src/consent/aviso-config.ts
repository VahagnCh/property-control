export interface AvisoConfig {
  avisoVersion: string;
  avisoUrl: string;
}

export function loadAvisoConfig(env: NodeJS.ProcessEnv): AvisoConfig {
  const avisoVersion = env.AVISO_VERSION?.trim() ?? '';
  if (avisoVersion.length === 0) {
    throw new Error('AVISO_VERSION is required.');
  }
  const avisoUrl = env.AVISO_URL?.trim() ?? '';
  let parsed: URL;
  try {
    parsed = new URL(avisoUrl);
  } catch {
    throw new Error('AVISO_URL must be an http(s) URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AVISO_URL must be an http(s) URL.');
  }
  return { avisoVersion, avisoUrl };
}
