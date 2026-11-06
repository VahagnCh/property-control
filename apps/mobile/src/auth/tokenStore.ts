import * as SecureStore from 'expo-secure-store';

/**
 * Auth tokens live in the platform secure store (Keychain on iOS, Keystore on Android).
 * Access and refresh are one item so a failed write cannot keep only one of them.
 * They are not written to AsyncStorage, the JS bundle, or a URL.
 * Accessibility is this-device-only so a backup restore does not copy them.
 * Biometrics stay off so Expo Go can read the store without a Face ID prompt.
 */
const SESSION_KEY = 'duerecord.auth.session';
const LEGACY_ACCESS_KEY = 'duerecord.auth.access';
const LEGACY_REFRESH_KEY = 'duerecord.auth.refresh';

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

/** The secure store could not be read. This is not a signed-out session. */
export class TokenStoreUnavailableError extends Error {
  constructor() {
    super('TokenStoreUnavailableError');
    this.name = 'TokenStoreUnavailableError';
  }
}

export async function saveAuthTokens(tokens: AuthTokens): Promise<void> {
  const payload = JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
  try {
    await SecureStore.setItemAsync(SESSION_KEY, payload, options);
  } catch {
    throw new Error('Could not store the session.');
  }
  await deleteLegacy();
}

export async function readAuthTokens(): Promise<AuthTokens | null> {
  const raw = await readItem(SESSION_KEY);
  const current = parseSession(raw);
  if (current) {
    await deleteLegacy();
    return current;
  }
  if (raw) {
    await deleteItem(SESSION_KEY);
  }
  const accessToken = await readItem(LEGACY_ACCESS_KEY);
  const refreshToken = await readItem(LEGACY_REFRESH_KEY);
  if (accessToken && refreshToken) {
    await saveAuthTokens({ accessToken, refreshToken });
    return { accessToken, refreshToken };
  }
  if (accessToken || refreshToken) {
    await deleteLegacy();
  }
  return null;
}

async function readItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key, options);
  } catch {
    throw new TokenStoreUnavailableError();
  }
}

async function deleteItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key, options);
  } catch {
    throw new TokenStoreUnavailableError();
  }
}

export async function clearAuthTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, options);
  await deleteLegacy();
}

/**
 * Session storage for the API client. Login screens are not built yet, so
 * callers depend on this interface instead of a sign-in route.
 * The production value is `secureTokenStore`, which uses expo-secure-store only.
 */
export interface TokenStore {
  read(): Promise<AuthTokens | null>;
  save(tokens: AuthTokens): Promise<void>;
  clear(): Promise<void>;
}

export const secureTokenStore: TokenStore = {
  read: readAuthTokens,
  save: saveAuthTokens,
  clear: clearAuthTokens,
};

function parseSession(raw: string | null): AuthTokens | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { accessToken?: unknown; refreshToken?: unknown };
    if (typeof parsed.accessToken !== 'string' || parsed.accessToken === '') {
      return null;
    }
    if (typeof parsed.refreshToken !== 'string' || parsed.refreshToken === '') {
      return null;
    }
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
  } catch {
    return null;
  }
}

async function deleteLegacy(): Promise<void> {
  await SecureStore.deleteItemAsync(LEGACY_ACCESS_KEY, options).catch(() => undefined);
  await SecureStore.deleteItemAsync(LEGACY_REFRESH_KEY, options).catch(() => undefined);
}
