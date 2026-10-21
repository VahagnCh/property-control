export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  const origins: string[] = [];
  for (const part of raw.split(',')) {
    const origin = part.trim();
    if (origin.length === 0 || origin === '*') {
      continue;
    }
    origins.push(origin);
  }
  return origins;
}

export function corsOriginOption(
  origins: readonly string[],
): false | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean | string) => void) => void) {
  const list = origins.filter((origin) => origin !== '*');
  if (list.length === 0) {
    return false;
  }
  const allow = new Set(list);
  return (origin, callback) => {
    if (!origin || !allow.has(origin)) {
      callback(null, false);
      return;
    }
    callback(null, origin);
  };
}
