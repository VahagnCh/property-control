import fs from 'fs';
import path from 'path';
import * as SecureStore from 'expo-secure-store';
import { COPY } from '../copy/userFacing';
import { saveAuthTokens, secureTokenStore } from '../auth/tokenStore';
import { createApiClient } from './client';
import { readApiBaseUrl } from './config';
import { apiBaseUrlFromConfig } from './createAppClient';
import { REFRESH_PATH } from './contract';
import { PROPERTY_ID } from './testing/fixtures';
import { createContractFakeServer } from './testing/fakeServer';

jest.mock('expo-secure-store', () => {
  const memory = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    __memory: memory,
    setItemAsync: jest.fn(async (key: string, value: string) => {
      memory.set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => memory.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      memory.delete(key);
    }),
  };
});

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: { apiBaseUrl: 'https://api.duerecord.invalid' },
    },
  },
}));

const memory = (SecureStore as unknown as { __memory: Map<string, string> }).__memory;
const PROPERTY_PATH = `/v1/properties/${PROPERTY_ID}`;
const PAYMENT_PATH = `/v1/properties/${PROPERTY_ID}/payments`;
const ROOT = path.join(__dirname, '../..');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

describe('Trust checks', () => {
  it('keeps the fake server and fixtures out of production app code', () => {
    const testingDir = path.join(ROOT, 'src/api/testing');
    expect(fs.existsSync(path.join(testingDir, 'fakeServer.ts'))).toBe(true);
    expect(fs.existsSync(path.join(testingDir, 'fixtures.ts'))).toBe(true);

    const files = walkApp(ROOT);
    const importers = files.filter((file) =>
      /api\/testing|fakeServer|testing\/fixtures/.test(read(file)),
    );
    expect(importers).toEqual([]);
    expect(read(path.join(ROOT, 'App.tsx'))).not.toContain('fakeServer');
    expect(read(path.join(ROOT, 'index.ts'))).not.toContain('fakeServer');
  });

  it('requires an https API base URL and does not read an EXPO_PUBLIC_ secret', () => {
    const marker = ['EXPO', 'PUBLIC'].join('_');
    for (const relative of ['src/api/config.ts', 'src/api/createAppClient.ts', 'src/api/client.ts', 'app.json']) {
      const source = read(path.join(ROOT, relative));
      expect(source.includes(marker)).toBe(false);
      expect(source.includes('process.env')).toBe(false);
    }

    const app = JSON.parse(read(path.join(ROOT, 'app.json'))) as {
      expo: { extra: { apiBaseUrl: string } };
    };
    expect(app.expo.extra.apiBaseUrl).toBe('https://api.duerecord.invalid');
    expect(app.expo.extra.apiBaseUrl.startsWith('https://')).toBe(true);
    expect(apiBaseUrlFromConfig('production')).toBe('https://api.duerecord.invalid');

    expect(readApiBaseUrl('https://api.duerecord.invalid/', 'production')).toBe('https://api.duerecord.invalid');
    expect(readApiBaseUrl('http://127.0.0.1:4010', 'test')).toBe('http://127.0.0.1:4010');
    expect(readApiBaseUrl('http://10.0.2.2:3000', 'dev')).toBe('http://10.0.2.2:3000');
    expect(() => readApiBaseUrl('http://api.duerecord.invalid', 'production')).toThrow(/https/);
    expect(() => readApiBaseUrl('https://user:s3cret@api.duerecord.invalid', 'production')).toThrow(/credentials/);

    try {
      readApiBaseUrl('http://user:s3cret@evil.example/path', 'production');
      throw new Error('expected the http URL to be rejected');
    } catch (error) {
      expect((error as Error).message).not.toContain('s3cret');
      expect((error as Error).message).not.toContain('evil.example');
    }
  });

  it('keeps tokens, idempotency keys, and bodies out of logs, errors, and Conectando', async () => {
    const access = 'access-secret-7f3a';
    const refresh = 'refresh-secret-7f3a';
    const idem = 'idem-secret-7f3a';
    const bodyMarker = 'body-secret-7f3a';
    const leakUrl = 'https://evil.example/leak-7f3a';
    const leaks = [access, refresh, idem, bodyMarker, leakUrl];
    const server = createContractFakeServer();
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4010',
      env: 'test',
      tokenStore: {
        async read() {
          return { accessToken: access, refreshToken: refresh };
        },
        async save() {
          return undefined;
        },
        async clear() {
          return undefined;
        },
      },
      fetchImpl: server.fetch,
    });
    const snapshots: string[] = [];
    server.route('GET', '/v1/health', () => {
      snapshots.push(JSON.stringify(client.connection()));
      return { status: 200, body: { status: 'ok', echo: `${access} ${refresh} ${idem}` } };
    });
    server.route('POST', PAYMENT_PATH, () => ({
      status: 422,
      body: {
        statusCode: 422,
        error: 'paid_at_out_of_range',
        message: `rejected ${access} ${refresh} ${idem} ${bodyMarker} ${leakUrl}`,
      },
    }));

    const logs: string[] = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    for (const method of methods) {
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
      });
    }

    const error = await client
      .createPayment(
        PROPERTY_ID,
        { obligationId: bodyMarker, amount: '10.00', paidAt: '2026-10-29', notes: leakUrl },
        { intent: 'reintentar', key: idem },
      )
      .then(
        () => {
          throw new Error('expected a rejection');
        },
        (caught: unknown) => caught,
      );
    snapshots.push(JSON.stringify(client.connection()));

    expect(snapshots[0]).toBe(JSON.stringify({ phase: 'connecting', label: 'Conectando…', copyKey: null }));
    expect((error as Error).message).toBe(COPY['common.error']);
    const dumped = dump(error);
    const haystack = [dumped, logs.join('\n'), snapshots.join('\n')].join('\n');
    for (const leak of leaks) {
      expect(haystack).not.toContain(leak);
    }
    for (const request of server.requests) {
      expect(request.url).not.toContain(access);
      expect(request.url).not.toContain(refresh);
      expect(request.url).not.toContain(idem);
    }
    expect(server.calls('POST', PAYMENT_PATH)[0]?.headers['idempotency-key']).toBe(idem);
    expect(server.calls('POST', PAYMENT_PATH)[0]?.headers.authorization).toBe(`Bearer ${access}`);

    for (const method of methods) {
      (console[method] as unknown as { mockRestore: () => void }).mockRestore();
    }
  });

  it('clears SecureStore and emits sign-in-required when refresh fails, without a retry loop', async () => {
    memory.clear();
    await saveAuthTokens({ accessToken: 'access-live', refreshToken: 'refresh-live' });
    const server = createContractFakeServer();
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4010',
      env: 'test',
      tokenStore: secureTokenStore,
      fetchImpl: server.fetch,
    });
    server.route('GET', PROPERTY_PATH, () => ({
      status: 401,
      body: { statusCode: 401, error: 'token_expired', message: 'Token expired.' },
    }));
    server.route('POST', REFRESH_PATH, () => ({
      status: 401,
      body: { statusCode: 401, error: 'token_invalid', message: 'Token is not accepted.' },
    }));

    const events: Array<{ type: string }> = [];
    let clearedBeforeEvent = false;
    client.subscribe((event) => {
      clearedBeforeEvent = !memory.has('duerecord.auth.access') && !memory.has('duerecord.auth.refresh');
      events.push(event);
    });

    await expect(client.getProperty(PROPERTY_ID)).rejects.toMatchObject({ code: 'sign_in_required' });
    expect(server.calls('POST', REFRESH_PATH)).toHaveLength(1);
    expect(server.calls('GET', PROPERTY_PATH)).toHaveLength(1);
    expect(clearedBeforeEvent).toBe(true);
    expect(memory.has('duerecord.auth.access')).toBe(false);
    expect(memory.has('duerecord.auth.refresh')).toBe(false);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'duerecord.auth.access',
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    );
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'duerecord.auth.refresh',
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    );
    expect(events).toEqual([{ type: 'sign-in-required' }]);
    expect(JSON.stringify(events[0])).toBe('{"type":"sign-in-required"}');

    await expect(client.getProperty(PROPERTY_ID)).rejects.toMatchObject({ code: 'sign_in_required' });
    expect(server.calls('POST', REFRESH_PATH)).toHaveLength(1);
    expect(server.calls('GET', PROPERTY_PATH)).toHaveLength(1);
    expect(events).toHaveLength(1);
  });
});

function dump(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const fields = Object.getOwnPropertyNames(error).map((key) => {
    const value = (error as unknown as Record<string, unknown>)[key];
    return `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`;
  });
  return `${error.name} ${error.message} ${fields.join(' ')}`;
}

function walkApp(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'coverage' ||
      entry.name === '.expo' ||
      entry.name === 'testing'
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkApp(full, acc);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}
