import fs from 'fs';
import path from 'path';
import * as SecureStore from 'expo-secure-store';
import { clearAuthTokens, readAuthTokens, saveAuthTokens } from './tokenStore';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  setItemAsync: jest.fn(async () => undefined),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const ACCESS = 'sekret-access';
const REFRESH = 'sekret-refresh';

function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function usesAsyncStorage(source: string): boolean {
  return /AsyncStorage|@react-native-async-storage/.test(codeWithoutComments(source));
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === '.expo') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx|js|json)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('auth token store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockReset();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (SecureStore.setItemAsync as jest.Mock).mockReset();
    (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
    (SecureStore.deleteItemAsync as jest.Mock).mockReset();
    (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('writes and reads tokens only through expo-secure-store', async () => {
    const stored = JSON.stringify({ accessToken: ACCESS, refreshToken: REFRESH });
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) =>
      key === 'duerecord.auth.session' ? stored : null,
    );

    await saveAuthTokens({ accessToken: ACCESS, refreshToken: REFRESH });
    await expect(readAuthTokens()).resolves.toEqual({
      accessToken: ACCESS,
      refreshToken: REFRESH,
    });

    const setCalls = (SecureStore.setItemAsync as jest.Mock).mock.calls;
    expect(setCalls.map((call) => call[0])).toEqual(['duerecord.auth.session']);
    expect(JSON.parse(setCalls[0][1] as string)).toEqual({ accessToken: ACCESS, refreshToken: REFRESH });
    expect(setCalls[0][2]).toEqual({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    expect(setCalls[0][2]).not.toHaveProperty('requireAuthentication');

    await clearAuthTokens();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'duerecord.auth.session',
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    );
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'duerecord.auth.access',
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    );
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'duerecord.auth.refresh',
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    );
  });

  it('does not leave a half-written session when the single write fails', async () => {
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error(`disk ${ACCESS}`));
    await expect(saveAuthTokens({ accessToken: ACCESS, refreshToken: REFRESH })).rejects.toThrow(
      'Could not store the session.',
    );
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
    const stored = JSON.parse((SecureStore.setItemAsync as jest.Mock).mock.calls[0][1] as string) as {
      accessToken: string;
      refreshToken: string;
    };
    expect(stored).toEqual({ accessToken: ACCESS, refreshToken: REFRESH });
    await expect(readAuthTokens()).resolves.toBeNull();
  });

  it('clears a legacy access key when the refresh key is missing', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) =>
      key === 'duerecord.auth.access' ? ACCESS : null,
    );
    await expect(readAuthTokens()).resolves.toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('duerecord.auth.access', expect.any(Object));
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('throws when secure store read fails and does not rethrow the stored value', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error(`boom ${ACCESS}`));
    await expect(readAuthTokens()).rejects.toMatchObject({ name: 'TokenStoreUnavailableError' });
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('does not import AsyncStorage, and no mobile source does', () => {
    const root = process.cwd();
    const store = fs.readFileSync(path.join(root, 'src/auth/tokenStore.ts'), 'utf8');
    expect(store).toContain("from 'expo-secure-store'");
    expect(usesAsyncStorage(store)).toBe(false);

    const session = fs.readFileSync(path.join(root, 'src/session/readSession.ts'), 'utf8');
    expect(usesAsyncStorage(session)).toBe(false);
    expect(codeWithoutComments(session)).not.toContain('expo-secure-store');

    const shell = fs.readFileSync(path.join(root, 'src/navigation/AppShell.tsx'), 'utf8');
    expect(usesAsyncStorage(shell)).toBe(false);
    expect(codeWithoutComments(shell)).not.toContain('expo-secure-store');
    expect(codeWithoutComments(shell)).not.toContain('setItemAsync');

    const files = walk(path.join(root, 'src')).concat([
      path.join(root, 'App.tsx'),
      path.join(root, 'index.ts'),
      path.join(root, 'app.json'),
    ]);
    const offenders = files.filter((file) => usesAsyncStorage(fs.readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('does not inline EXPO_PUBLIC_ values into the app sources or app config', () => {
    const root = process.cwd();
    const marker = 'EXPO_' + 'PUBLIC_';
    const files = walk(root);
    const offenders = files.filter((file) => fs.readFileSync(file, 'utf8').includes(marker));
    expect(offenders).toEqual([]);
  });
});
