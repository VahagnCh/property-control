import * as SecureStore from 'expo-secure-store';
import { COPY } from '../copy/userFacing';
import { secureTokenStore } from '../auth/tokenStore';
import type { TokenStore } from '../auth/tokenStore';
import { resetSessionState, readSessionSnapshot } from '../session/readSession';
import { createApiClient } from './client';
import {
  AUTH_CODE_ACCEPTED_MESSAGE,
  AUTH_CODE_PATH,
  AUTH_LOGOUT_PATH,
  AUTH_SESSION_PATH,
  AUTH_VERIFY_PATH,
  REFRESH_PATH,
} from './contract';
import { createContractFakeServer } from './testing/fakeServer';

jest.mock('expo-secure-store', () => {
  const memory = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    __memory: memory,
    isAvailableAsync: jest.fn(async () => true),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      memory.set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => memory.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      memory.delete(key);
    }),
  };
});

const memory = (SecureStore as unknown as { __memory: Map<string, string> }).__memory;
const EMAIL = 'persona@ejemplo.com';
const CODE = '123456';
const ACCESS = 'access-verify-secret';
const REFRESH = 'rt_verify-secret';

function v4(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function memoryStore(initial: { accessToken: string; refreshToken: string } | null = null): TokenStore & {
  current: () => { accessToken: string; refreshToken: string } | null;
  saves: () => Array<{ accessToken: string; refreshToken: string }>;
} {
  let current = initial;
  const saves: Array<{ accessToken: string; refreshToken: string }> = [];
  return {
    current: () => current,
    saves: () => saves,
    async read() {
      return current;
    },
    async save(tokens) {
      saves.push(tokens);
      current = tokens;
    },
    async clear() {
      current = null;
    },
  };
}

function setup(options?: { randomUUID?: () => string; tokens?: { accessToken: string; refreshToken: string } | null }) {
  const server = createContractFakeServer();
  const tokens = memoryStore(options?.tokens ?? null);
  const client = createApiClient({
    baseUrl: 'http://127.0.0.1:4010',
    env: 'test',
    tokenStore: tokens,
    fetchImpl: server.fetch,
    randomUUID: options?.randomUUID,
  });
  return { server, client, tokens };
}

function codeBody(message: string) {
  return { statusCode: 400, error: message, message };
}

describe('email-code client', () => {
  beforeEach(() => {
    memory.clear();
    resetSessionState();
    jest.clearAllMocks();
  });

  it('accepts 202 without saying whether the account exists', async () => {
    const { server, client } = setup();
    await expect(client.requestCode(EMAIL)).resolves.toEqual({ accepted: true, resendAfterSeconds: 60 });
    const posts = server.calls('POST', AUTH_CODE_PATH);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.headers.authorization).toBeUndefined();
    expect(posts[0]?.headers['idempotency-key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(posts[0]?.bodyText).toBe(JSON.stringify({ email: EMAIL }));
    expect(server.calls('POST', REFRESH_PATH)).toHaveLength(0);
    expect(AUTH_CODE_ACCEPTED_MESSAGE).toBe('Si el correo es válido, te enviamos un código.');
  });

  it('maps 400, 429 with Retry-After, and 503', async () => {
    const invalid = setup();
    invalid.server.route('POST', AUTH_CODE_PATH, () => ({
      status: 400,
      body: { statusCode: 400, error: 'auth.email_invalid', message: `rejected ${EMAIL}` },
    }));
    const invalidError = await invalid.client.requestCode('not-an-email').then(
      () => {
        throw new Error('expected a rejection');
      },
      (caught: unknown) => caught,
    );
    expect(invalidError).toMatchObject({
      status: 400,
      code: 'auth.email_invalid',
      copyKey: 'auth.email.invalid',
      message: COPY['auth.email.invalid'],
    });
    expect(JSON.stringify(invalidError)).not.toContain(EMAIL);
    expect(JSON.stringify(invalidError)).not.toContain('not-an-email');

    const limited = setup();
    limited.server.route('POST', AUTH_CODE_PATH, () => ({
      status: 429,
      headers: { 'retry-after': '75' },
      body: { statusCode: 429, error: 'auth.rate_limited', message: 'Too many attempts.' },
    }));
    await expect(limited.client.requestCode(EMAIL)).rejects.toMatchObject({
      status: 429,
      code: 'auth.rate_limited',
      copyKey: 'auth.code.wait',
      message: COPY['auth.code.wait'],
      retryAfterSeconds: 75,
    });

    const down = setup();
    down.server.route('POST', AUTH_CODE_PATH, () => ({
      status: 503,
      body: { statusCode: 503, error: 'auth.unavailable', message: 'Login email is not configured.' },
    }));
    await expect(down.client.requestCode(EMAIL)).rejects.toMatchObject({
      code: 'auth.unavailable',
      copyKey: 'common.connecting.failed',
      message: COPY['common.connecting.failed'],
    });
  });

  it('stores verify tokens in one write and does not refresh on auth.code_invalid', async () => {
    const { server, client, tokens } = setup({
      tokens: { accessToken: 'stale-access', refreshToken: 'stale-refresh' },
    });
    let verifies = 0;
    server.route('POST', AUTH_VERIFY_PATH, (request) => {
      verifies += 1;
      expect(request.headers.authorization).toBeUndefined();
      expect(request.headers['idempotency-key']).toBeUndefined();
      if (verifies === 1) {
        return {
          status: 401,
          body: { statusCode: 401, error: 'auth.code_invalid', message: `wrong ${EMAIL} ${CODE}` },
        };
      }
      return {
        status: 200,
        body: { tokenType: 'Bearer', accessToken: ACCESS, expiresIn: 900, refreshToken: REFRESH },
      };
    });

    const wrong = await client.verifyCode(EMAIL, CODE).then(
      () => {
        throw new Error('expected a rejection');
      },
      (caught: unknown) => caught,
    );
    expect(wrong).toMatchObject({
      status: 401,
      code: 'auth.code_invalid',
      copyKey: 'auth.code.wrong',
      message: COPY['auth.code.wrong'],
    });
    expect(JSON.stringify(wrong)).not.toContain(EMAIL);
    expect(JSON.stringify(wrong)).not.toContain(CODE);
    expect(JSON.stringify(wrong)).not.toContain(ACCESS);
    expect(server.calls('POST', REFRESH_PATH)).toHaveLength(0);
    expect(verifies).toBe(1);
    expect(tokens.current()).toEqual({ accessToken: 'stale-access', refreshToken: 'stale-refresh' });
    expect(tokens.saves()).toHaveLength(0);

    await expect(client.verifyCode(EMAIL, '654321')).resolves.toEqual({ expiresIn: 900 });
    expect(verifies).toBe(2);
    expect(server.calls('POST', REFRESH_PATH)).toHaveLength(0);
    expect(tokens.saves()).toEqual([{ accessToken: ACCESS, refreshToken: REFRESH }]);
    expect(tokens.current()).toEqual({ accessToken: ACCESS, refreshToken: REFRESH });
    expect(readSessionSnapshot()).toMatchObject({ signedIn: true, expired: false, unavailable: false });
  });

  it('writes the verified pair as one SecureStore item', async () => {
    memory.clear();
    const server = createContractFakeServer();
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4010',
      env: 'test',
      tokenStore: secureTokenStore,
      fetchImpl: server.fetch,
    });
    server.route('POST', AUTH_VERIFY_PATH, () => ({
      status: 200,
      body: { tokenType: 'Bearer', accessToken: ACCESS, expiresIn: 900, refreshToken: REFRESH },
    }));
    await client.verifyCode(EMAIL, CODE);
    const calls = (SecureStore.setItemAsync as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('duerecord.auth.session');
    expect(JSON.parse(calls[0]?.[1] as string)).toEqual({ accessToken: ACCESS, refreshToken: REFRESH });
    expect(memory.get('duerecord.auth.session')).toContain(ACCESS);
  });

  it('makes exactly one code request on a network error and reuses the key on Reintentar', async () => {
    let n = 0;
    const ids = [v4(1), v4(2), v4(3), v4(4)];
    const { server, client } = setup({ randomUUID: () => ids[n++] ?? v4(9) });
    const keys: string[] = [];
    server.route('POST', AUTH_CODE_PATH, (request) => {
      keys.push(request.headers['idempotency-key'] ?? '');
      if (keys.length === 1) {
        return { status: 202, networkError: true };
      }
      if (keys.length === 2) {
        return { status: 202, body: { message: AUTH_CODE_ACCEPTED_MESSAGE } };
      }
      return { status: 202, body: { message: AUTH_CODE_ACCEPTED_MESSAGE } };
    });

    await expect(client.requestCode(EMAIL, 'send')).rejects.toMatchObject({ code: 'connecting_failed' });
    expect(server.calls('POST', AUTH_CODE_PATH)).toHaveLength(1);
    expect(server.calls('POST', REFRESH_PATH)).toHaveLength(0);

    await client.requestCode(EMAIL, 'retry');
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBe(v4(1));

    await client.requestCode('otra@ejemplo.com', 'send');
    expect(keys[2]).toBe(v4(2));
    expect(keys[2]).not.toBe(keys[1]);

    await client.requestCode(EMAIL, 'resend');
    expect(keys[3]).toBe(v4(3));
    expect(keys[3]).not.toBe(keys[1]);
  });

  it('mints a new key after a 4xx and keeps the key after a 5xx until Reenviar', async () => {
    let n = 0;
    const ids = [v4(1), v4(2), v4(3)];
    const { server, client } = setup({ randomUUID: () => ids[n++] ?? v4(9) });
    const keys: string[] = [];
    let posts = 0;
    server.route('POST', AUTH_CODE_PATH, (request) => {
      posts += 1;
      keys.push(request.headers['idempotency-key'] ?? '');
      if (posts === 1) {
        return { status: 503, body: { statusCode: 503, error: 'auth.unavailable', message: 'down' } };
      }
      if (posts === 2) {
        return { status: 400, body: codeBody('auth.email_invalid') };
      }
      return { status: 202, body: { message: AUTH_CODE_ACCEPTED_MESSAGE } };
    });
    await expect(client.requestCode(EMAIL, 'send')).rejects.toMatchObject({ code: 'auth.unavailable' });
    await expect(client.requestCode(EMAIL, 'retry')).rejects.toMatchObject({ code: 'auth.email_invalid' });
    expect(keys[0]).toBe(keys[1]);
    await client.requestCode(EMAIL, 'resend');
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('rejects an undocumented code without treating the account as locked', async () => {
    const { server, client } = setup();
    server.route('POST', AUTH_VERIFY_PATH, () => ({
      status: 401,
      body: { statusCode: 401, error: 'auth.locked', message: 'Account is locked.' },
    }));
    const error = await client.verifyCode(EMAIL, CODE).then(
      () => {
        throw new Error('expected a rejection');
      },
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: 'unknown', copyKey: 'common.error' });
    expect((error as Error).message).not.toMatch(/lock|bloque/i);
    expect(JSON.stringify(error)).not.toContain(CODE);
  });

  it('logs out by clearing the secure item and reads the session', async () => {
    memory.clear();
    const server = createContractFakeServer();
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4010',
      env: 'test',
      tokenStore: secureTokenStore,
      fetchImpl: server.fetch,
    });
    server.route('POST', AUTH_VERIFY_PATH, () => ({
      status: 200,
      body: { tokenType: 'Bearer', accessToken: ACCESS, expiresIn: 900, refreshToken: REFRESH },
    }));
    await client.verifyCode(EMAIL, CODE);
    await expect(client.readServerSession()).resolves.toEqual({ sub: 'user-1', sid: 'sid-1' });
    await client.logout();
    expect(memory.has('duerecord.auth.session')).toBe(false);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      'duerecord.auth.session',
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    );
    expect(server.calls('POST', AUTH_LOGOUT_PATH)).toHaveLength(1);
    expect(readSessionSnapshot().signedIn).toBe(false);
    const logoutBody = server.calls('POST', AUTH_LOGOUT_PATH)[0]?.bodyText;
    expect(logoutBody ?? '').not.toContain(ACCESS);
    expect(logoutBody ?? '').not.toContain(EMAIL);
  });

  it('sends an expired refresh to sign-in without a store read error', async () => {
    const { server, client, tokens } = setup({
      tokens: { accessToken: 'live-access', refreshToken: 'live-refresh' },
    });
    server.route('GET', '/v1/auth/session', () => ({
      status: 401,
      body: { statusCode: 401, error: 'token_expired', message: 'Token expired.' },
    }));
    server.route('POST', REFRESH_PATH, () => ({
      status: 401,
      body: { statusCode: 401, error: 'auth.refresh_invalid', message: 'The refresh token is not valid.' },
    }));
    await expect(client.readServerSession()).rejects.toMatchObject({ code: 'sign_in_required' });
    expect(tokens.current()).toBeNull();
    expect(readSessionSnapshot()).toMatchObject({ signedIn: false, expired: true, unavailable: false });
    expect(server.calls('POST', REFRESH_PATH)).toHaveLength(1);
  });
});
