const LOCAL_DATE_METHODS = [
  'getFullYear',
  'getMonth',
  'getDate',
  'getHours',
  'getMinutes',
  'getSeconds',
  'getDay',
  'getTimezoneOffset',
] as const;

/** Throws if calendar code reads the device zone through Date local getters. */
export function withDeviceLocalBlocked<T>(run: () => T): T {
  const proto = Date.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const originals = new Map<string, (...args: unknown[]) => unknown>();
  for (const name of LOCAL_DATE_METHODS) {
    originals.set(name, proto[name]);
    proto[name] = () => {
      throw new Error(`device local ${name}`);
    };
  }
  try {
    return run();
  } finally {
    for (const name of LOCAL_DATE_METHODS) {
      proto[name] = originals.get(name) as (...args: unknown[]) => unknown;
    }
  }
}
