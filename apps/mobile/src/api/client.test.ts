import fs from 'fs';
import path from 'path';
import { COPY, copyText } from '../copy/userFacing';
import { HEALTH_STALE_MS, REQUEST_TIMEOUT_MS, createApiClient, mayAttachAuthorization, type ApiClient } from './client';
import { API_ERROR_CODES, REFRESH_PATH } from './contract';
import { IdempotencyKeyReusedError, copyKeyForApiError } from './errors';
import { OBLIGATION_ID, PROPERTY_ID, paymentCreated, propertyFixture } from './testing/fixtures';
import { createContractFakeServer, type FakeServer } from './testing/fakeServer';
import { TokenStoreUnavailableError, type TokenStore } from '../auth/tokenStore';

const BASE = 'http://127.0.0.1:4010';
const PROPERTY_PATH = `/v1/properties/${PROPERTY_ID}`;
const PAYMENT_PATH = `/v1/properties/${PROPERTY_ID}/payments`;
const ACCESS = 'access-1';
const REFRESH = 'refresh-1';

type MemoryStore = TokenStore & { current: () => { accessToken: string; refreshToken: string } | null };

function memoryStore(
  initial: { accessToken: string; refreshToken: string } | null = { accessToken: ACCESS, refreshToken: REFRESH },
): MemoryStore {
  let current = initial;
  return {
    current: () => current,
    async read() {
      return current;
    },
    async save(tokens) {
      current = tokens;
    },
    async clear() {
      current = null;
    },
  };
}

function setup(options?: {
  now?: () => number;
  randomUUID?: () => string;
  tokens?: { accessToken: string; refreshToken: string } | null;
}): { server: FakeServer; client: ApiClient; tokens: MemoryStore } {
  const server = createContractFakeServer();
  const tokens = memoryStore(options?.tokens);
  const client = createApiClient({
    baseUrl: BASE,
    env: 'test',
    tokenStore: tokens,
    fetchImpl: server.fetch,
    now: options?.now,
    randomUUID: options?.randomUUID,
  });
  return { server, client, tokens };
}

function paymentInput(paidAt: Date | string = '2026-10-29', amount = '1234.50') {
  return { obligationId: OBLIGATION_ID, amount, paidAt };
}

function v4(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

async function waitUntil(ready: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (ready()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  throw new Error('condition was not reached');
}

async function flushMicrotasks(): Promise<void> {
  for (let step = 0; step < 20; step += 1) {
    await Promise.resolve();
  }
}

describe('API client', () => {
  it('retries a GET once after a network error', async () => {
    const { server, client } = setup();
    let calls = 0;
    server.route('GET', PROPERTY_PATH, () => {
      calls += 1;
      if (calls === 1) {
        return { status: 200, networkError: true };
      }
      return { status: 200, body: propertyFixture };
    });
    await expect(client.getProperty(PROPERTY_ID)).resolves.toMatchObject({ id: PROPERTY_ID });
    expect(calls).toBe(2);
    expect(REQUEST_TIMEOUT_MS).toBe(15_000);
  });

  it('makes exactly one fetch when a write hits a network error', async () => {
    const { server, client } = setup();
    server.route('POST', PAYMENT_PATH, () => ({ status: 201, networkError: true }));
    const error = await client.createPayment(PROPERTY_ID, paymentInput()).then(
      () => {
        throw new Error('expected a rejection');
      },
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      code: 'connecting_failed',
      copyKey: 'common.connecting.failed',
      message: COPY['common.connecting.failed'],
      retryLabel: 'Reintentar',
    });
    expect((error as { idempotencyKey: string }).idempotencyKey).toEqual(expect.any(String));
    expect(server.calls('POST', PAYMENT_PATH)).toHaveLength(1);
    expect(server.calls('POST', REFRESH_PATH)).toHaveLength(0);
  });

  it('accepts a slow response that finishes inside the timeout', async () => {
    jest.useFakeTimers();
    try {
      const { server, client } = setup();
      server.route('GET', PROPERTY_PATH, () => ({ status: 200, body: propertyFixture, delayMs: 10_000 }));
      let status = 'pending';
      const pending = client.getProperty(PROPERTY_ID).then((body) => {
        status = 'ok';
        return body;
      });
      await flushMicrotasks();
      await jest.advanceTimersByTimeAsync(9_999);
      expect(status).toBe('pending');
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ id: PROPERTY_ID });
      expect(server.calls('GET', PROPERTY_PATH)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('refreshes once when several requests receive 401 together', async () => {
    const { server, client, tokens } = setup();
    let started = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.route('POST', REFRESH_PATH, async (request) => {
      started += 1;
      expect(request.bodyText).toContain(REFRESH);
      await gate;
      return { status: 200, body: { accessToken: 'access-2', refreshToken: 'refresh-2' } };
    });
    server.route('GET', PROPERTY_PATH, (request) => {
      if (request.headers.authorization === 'Bearer access-2') {
        return { status: 200, body: propertyFixture };
      }
      return { status: 401, body: { statusCode: 401, error: 'token_expired', message: 'Token expired.' } };
    });

    const first = client.getProperty(PROPERTY_ID);
    const second = client.getProperty(PROPERTY_ID);
    await waitUntil(() => started === 1);
    expect(started).toBe(1);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([propertyFixture, propertyFixture]);
    expect(started).toBe(1);
    expect(server.calls('GET', PROPERTY_PATH)).toHaveLength(4);
    expect(tokens.current()).toEqual({ accessToken: 'access-2', refreshToken: 'refresh-2' });
  });

  it('does not retry a 4xx response', async () => {
    const statuses = [400, 403, 404, 409, 422] as const;
    for (const status of statuses) {
      const { server, client } = setup();
      server.route('POST', PAYMENT_PATH, () => ({
        status,
        body: {
          statusCode: status,
          error: status === 404 ? 'not_found' : 'paid_at_out_of_range',
          message: 'https://api.example/internal paidAt is outside the allowed range.',
        },
      }));
      const error = await client.createPayment(PROPERTY_ID, paymentInput()).then(
        () => {
          throw new Error('expected a rejection');
        },
        (caught: unknown) => caught,
      );
      expect(server.calls('POST', PAYMENT_PATH)).toHaveLength(1);
      expect(server.calls('POST', REFRESH_PATH)).toHaveLength(0);
      expect(error).toMatchObject({
        status,
        copyKey: status === 404 ? 'common.notFound' : 'common.error',
      });
      expect((error as Error).message).not.toContain('https://');
      expect((error as Error).message).not.toContain('paidAt is outside');
    }
  });

  it('retries a refresh network error once with the same refresh token', async () => {
    const { server, client, tokens } = setup();
    const bodies: string[] = [];
    let attempts = 0;
    server.route('GET', PROPERTY_PATH, (request) => {
      if (request.headers.authorization === 'Bearer rotated-access') {
        return { status: 200, body: propertyFixture };
      }
      return { status: 401, body: { statusCode: 401, error: 'token_expired', message: 'Token expired.' } };
    });
    server.route('POST', REFRESH_PATH, (request) => {
      attempts += 1;
      bodies.push(request.bodyText ?? '');
      if (attempts === 1) {
        return { status: 200, networkError: true };
      }
      return { status: 200, body: { accessToken: 'rotated-access', refreshToken: 'rotated-refresh' } };
    });

    await expect(client.getProperty(PROPERTY_ID)).resolves.toMatchObject({ id: PROPERTY_ID });
    expect(attempts).toBe(2);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[0]).toContain(REFRESH);
    expect(tokens.current()?.accessToken).toBe('rotated-access');
    expect(server.calls('GET', PROPERTY_PATH)).toHaveLength(2);
  });

  it('stops after that one network retry when refresh keeps failing', async () => {
    const { server, client, tokens } = setup();
    const events: string[] = [];
    client.subscribe((event) => {
      events.push(event.type);
    });
    let attempts = 0;
    server.route('GET', PROPERTY_PATH, () => ({
      status: 401,
      body: { statusCode: 401, error: 'token_expired', message: 'Token expired.' },
    }));
    server.route('POST', REFRESH_PATH, () => {
      attempts += 1;
      return { status: 200, networkError: true };
    });

    await expect(client.getProperty(PROPERTY_ID)).rejects.toMatchObject({
      code: 'auth.unavailable',
      copyKey: 'common.connecting.failed',
    });
    expect(attempts).toBe(2);
    expect(tokens.current()).toEqual({ accessToken: ACCESS, refreshToken: REFRESH });
    expect(events).toEqual([]);
  });

  it('does not clear the session when refresh returns 503 auth.unavailable', async () => {
    const { server, client, tokens } = setup();
    const events: string[] = [];
    client.subscribe((event) => {
      events.push(event.type);
    });
    server.route('GET', PROPERTY_PATH, () => ({
      status: 401,
      body: { statusCode: 401, error: 'token_expired', message: 'Token expired.' },
    }));
    server.route('POST', REFRESH_PATH, () => ({
      status: 503,
      body: { statusCode: 503, error: 'auth.unavailable', message: 'Access tokens are not configured.' },
    }));
    await expect(client.getProperty(PROPERTY_ID)).rejects.toMatchObject({
      code: 'auth.unavailable',
      copyKey: 'common.connecting.failed',
    });
    expect(server.calls('POST', REFRESH_PATH)).toHaveLength(1);
    expect(tokens.current()).toEqual({ accessToken: ACCESS, refreshToken: REFRESH });
    expect(events).toEqual([]);
    expect((await client.getProperty(PROPERTY_ID).catch((error: Error) => error.message))).not.toContain(
      'not configured',
    );
  });

  it('reuses the same idempotency key when Reenviar follows a timeout of the same body', async () => {
    jest.useFakeTimers();
    try {
      let minted = 0;
      const { server, client } = setup({
        randomUUID: () => {
          minted += 1;
          return v4(minted);
        },
      });
      const keys: string[] = [];
      let calls = 0;
      server.route('POST', PAYMENT_PATH, (request) => {
        calls += 1;
        keys.push(request.headers['idempotency-key'] ?? '');
        if (calls === 1) {
          return { status: 201, hang: true };
        }
        const parsed = JSON.parse(request.bodyText ?? '{}') as { amount: string; paidAt: string };
        return { status: 201, body: paymentCreated(parsed.amount, parsed.paidAt) };
      });
      let caught: { idempotencyKey?: string } | undefined;
      const pending = client.createPayment(PROPERTY_ID, paymentInput()).then(
        () => undefined,
        (error: { idempotencyKey?: string }) => {
          caught = error;
        },
      );
      await flushMicrotasks();
      await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await pending;
      expect(caught?.idempotencyKey).toBe(v4(1));
      await client.createPayment(PROPERTY_ID, paymentInput());
      expect(keys).toEqual([v4(1), v4(1)]);
      expect(minted).toBe(1);
      expect(server.calls('GET', '/v1/health').every((call) => call.headers['idempotency-key'] === undefined)).toBe(
        true,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('mints a new idempotency key when the body changes', async () => {
    let minted = 0;
    const { server, client } = setup({
      randomUUID: () => {
        minted += 1;
        return v4(minted);
      },
    });
    const keys: string[] = [];
    server.route('POST', PAYMENT_PATH, (request) => {
      keys.push(request.headers['idempotency-key'] ?? '');
      const parsed = JSON.parse(request.bodyText ?? '{}') as { amount: string; paidAt: string };
      return { status: 201, body: paymentCreated(parsed.amount, parsed.paidAt) };
    });
    await client.createPayment(PROPERTY_ID, paymentInput('2026-10-29', '10.00'));
    await client.createPayment(PROPERTY_ID, paymentInput('2026-10-29', '11.00'));
    expect(keys).toEqual([v4(1), v4(2)]);
    expect(minted).toBe(2);
  });

  it('reuses the idempotency key after a 5xx because the server did not store that attempt', async () => {
    let minted = 0;
    const { server, client } = setup({
      randomUUID: () => {
        minted += 1;
        return v4(minted);
      },
    });
    const keys: string[] = [];
    let calls = 0;
    server.route('POST', PAYMENT_PATH, (request) => {
      calls += 1;
      keys.push(request.headers['idempotency-key'] ?? '');
      if (calls === 1) {
        return { status: 503, body: { statusCode: 503, error: 'auth.unavailable', message: 'unavailable' } };
      }
      const parsed = JSON.parse(request.bodyText ?? '{}') as { amount: string; paidAt: string };
      return { status: 201, body: paymentCreated(parsed.amount, parsed.paidAt) };
    });
    await expect(client.createPayment(PROPERTY_ID, paymentInput())).rejects.toMatchObject({ status: 503 });
    await client.createPayment(PROPERTY_ID, paymentInput());
    expect(keys).toEqual([v4(1), v4(1)]);
    expect(minted).toBe(1);
  });

  it('mints a new idempotency key after a definite 4xx', async () => {
    let minted = 0;
    const { server, client } = setup({
      randomUUID: () => {
        minted += 1;
        return v4(minted);
      },
    });
    const keys: string[] = [];
    let calls = 0;
    server.route('POST', PAYMENT_PATH, (request) => {
      calls += 1;
      keys.push(request.headers['idempotency-key'] ?? '');
      if (calls === 1) {
        return {
          status: 422,
          body: { statusCode: 422, error: 'paid_at_out_of_range', message: 'paidAt is outside the allowed range.' },
        };
      }
      return { status: 201, body: paymentCreated('1234.50', '2026-10-29') };
    });
    await expect(client.createPayment(PROPERTY_ID, paymentInput())).rejects.toMatchObject({ status: 422 });
    await client.createPayment(PROPERTY_ID, paymentInput());
    expect(keys[0]).not.toBe(keys[1]);
    expect(minted).toBe(2);
  });

  it('keeps the same idempotency key when a write is retried after refresh', async () => {
    const { server, client } = setup();
    const keys: string[] = [];
    let attempts = 0;
    server.route('POST', PAYMENT_PATH, (request) => {
      attempts += 1;
      keys.push(request.headers['idempotency-key'] ?? '');
      if (attempts === 1) {
        return { status: 401, body: { statusCode: 401, error: 'token_expired', message: 'Token expired.' } };
      }
      return { status: 201, body: paymentCreated('1234.50', '2026-10-29') };
    });
    await client.createPayment(PROPERTY_ID, paymentInput());
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('maps 409 idempotency_key_reused to its own error', async () => {
    const { server, client } = setup();
    server.route('POST', PAYMENT_PATH, () => ({
      status: 409,
      body: {
        statusCode: 409,
        error: 'idempotency_key_reused',
        message: 'This key was reused. See https://api.example/idempotency',
      },
    }));
    const error = await client.createPayment(PROPERTY_ID, paymentInput()).then(
      () => {
        throw new Error('expected a rejection');
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(IdempotencyKeyReusedError);
    expect(error).toMatchObject({
      code: 'idempotency_key_reused',
      copyKey: 'idempotency.keyReused',
      status: 409,
      message: COPY['idempotency.keyReused'],
    });
    expect((error as Error).message).not.toContain('https://');
    expect(server.calls('POST', PAYMENT_PATH)).toHaveLength(1);
  });

  it('skips the health check at 9m59s and runs it at 10m01s', async () => {
    expect(HEALTH_STALE_MS).toBe(10 * 60 * 1000);
    const server = createContractFakeServer();
    let health = 0;
    server.route('GET', '/v1/health', () => {
      health += 1;
      return { status: 200, body: { status: 'ok' } };
    });
    server.route('POST', PAYMENT_PATH, () => ({ status: 201, body: paymentCreated('1234.50', '2026-10-29') }));

    async function clientWithClock(): Promise<{ client: ApiClient; clock: { t: number } }> {
      const clock = { t: 0 };
      const client = createApiClient({
        baseUrl: BASE,
        env: 'test',
        tokenStore: memoryStore(),
        fetchImpl: server.fetch,
        now: () => clock.t,
      });
      await client.getProperty(PROPERTY_ID);
      return { client, clock };
    }

    const within = await clientWithClock();
    within.clock.t = HEALTH_STALE_MS - 1000;
    await within.client.createPayment(PROPERTY_ID, paymentInput());
    expect(health).toBe(0);

    const exact = await clientWithClock();
    exact.clock.t = HEALTH_STALE_MS;
    await exact.client.createPayment(PROPERTY_ID, paymentInput());
    expect(health).toBe(0);

    const past = await clientWithClock();
    past.clock.t = HEALTH_STALE_MS + 1000;
    await past.client.createPayment(PROPERTY_ID, paymentInput());
    expect(health).toBe(1);
  });

  it('shows Conectando while the health check is in flight and maps failure to common.connecting.failed', async () => {
    const { server, client } = setup();
    let release: (result: { status: number; body: { status: string } }) => void = () => undefined;
    const gate = new Promise<{ status: number; body: { status: string } }>((resolve) => {
      release = resolve;
    });
    let during = '';
    server.route('GET', '/v1/health', () => {
      during = JSON.stringify(client.connection());
      return gate;
    });
    const pending = client.createPayment(PROPERTY_ID, paymentInput());
    await waitUntil(() => during !== '');
    expect(JSON.parse(during)).toEqual({ phase: 'connecting', label: 'Conectando…', copyKey: null });
    release({ status: 200, body: { status: 'ok' } });
    await pending;
    expect(client.connection()).toEqual({ phase: 'idle', label: null, copyKey: null });

    const failed = setup();
    failed.server.route('GET', '/v1/health', () => ({ status: 503, body: { status: 'unavailable' } }));
    const error = await failed.client.createPayment(PROPERTY_ID, paymentInput()).then(
      () => {
        throw new Error('expected a rejection');
      },
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      code: 'connecting_failed',
      copyKey: 'common.connecting.failed',
      message: COPY['common.connecting.failed'],
    });
    expect(failed.client.connection()).toEqual({
      phase: 'failed',
      label: null,
      copyKey: 'common.connecting.failed',
    });
    expect(failed.server.calls('POST', PAYMENT_PATH)).toHaveLength(0);
  });

  it('sends paidAt as the America/Mexico_City calendar date at 23:59, 00:00, and 00:01', async () => {
    const { server, client } = setup();
    const sent: string[] = [];
    server.route('POST', PAYMENT_PATH, (request) => {
      sent.push(request.bodyText ?? '');
      const parsed = JSON.parse(request.bodyText ?? '{}') as { paidAt: string; amount: string };
      return { status: 201, body: paymentCreated(parsed.amount, parsed.paidAt) };
    });
    const cases: Array<[string, string]> = [
      ['2026-10-30T05:59:00.000Z', '2026-10-29'],
      ['2026-10-30T06:00:00.000Z', '2026-10-30'],
      ['2026-10-30T06:01:00.000Z', '2026-10-30'],
    ];
    for (const [instant, calendar] of cases) {
      const date = new Date(instant);
      expect(date.toISOString().slice(0, 10)).toBe('2026-10-30');
      await client.createPayment(PROPERTY_ID, paymentInput(date));
      expect(sent[sent.length - 1]).toContain(`"paidAt":"${calendar}"`);
    }
    expect(sent[0]).toContain('"paidAt":"2026-10-29"');
    expect(sent[0]).not.toContain('"paidAt":"2026-10-30"');
  });

  it('sends money as a decimal peso string and rejects a numeric amount', async () => {
    const { server, client } = setup();
    const raw: string[] = [];
    server.route('POST', PAYMENT_PATH, (request) => {
      raw.push(request.bodyText ?? '');
      const parsed = JSON.parse(request.bodyText ?? '{}') as { paidAt: string; amount: string };
      return { status: 201, body: paymentCreated(parsed.amount, parsed.paidAt) };
    });
    await client.createPayment(PROPERTY_ID, paymentInput('2026-10-29', '1234.50'));
    await client.createPayment(PROPERTY_ID, paymentInput('2026-10-29', '0.10'));
    await client.createPayment(PROPERTY_ID, paymentInput('2026-10-29', '10.5'));
    expect(raw[0]).toContain('"amount":"1234.50"');
    expect(raw[0]).toContain('"currency":"MXN"');
    expect(raw[1]).toContain('"amount":"0.10"');
    expect(raw[2]).toContain('"amount":"10.50"');
    for (const body of raw) {
      expect(body).not.toMatch(/"amount":\s*\d/);
    }

    const rejected = setup();
    await expect(
      rejected.client.request('POST', PAYMENT_PATH, {
        body: { obligationId: OBLIGATION_ID, amount: 10.5, currency: 'MXN', paidAt: '2026-10-29' },
      }),
    ).rejects.toMatchObject({ code: 'amount_invalid', message: COPY['common.error'] });
    expect(rejected.server.calls('POST', PAYMENT_PATH)).toHaveLength(0);

    const numeric = setup();
    numeric.server.route('POST', PAYMENT_PATH, () => ({
      status: 201,
      body: { payment: { ...paymentCreated('1.00', '2026-10-29').payment, amount: 1.5 }, warnings: [] },
    }));
    await expect(numeric.client.createPayment(PROPERTY_ID, paymentInput())).rejects.toMatchObject({
      code: 'amount_invalid',
    });
  });

  it('maps a non-member 404 to not-found copy', async () => {
    const { client } = setup();
    const missing = '44444444-4444-4444-8444-444444444444';
    const error = await client.getProperty(missing).then(
      () => {
        throw new Error('expected a rejection');
      },
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      status: 404,
      code: 'not_found',
      copyKey: 'common.notFound',
      message: COPY['common.notFound'],
    });
    expect((error as Error).message).not.toContain('Not found');
    expect((error as Error).message).not.toContain(missing);
  });

  it('recognizes every OCR error code from the API contract', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../api/src/ocr/ocr-errors.ts'),
      'utf8',
    );
    const start = source.indexOf('export const OCR_ERROR');
    const end = source.indexOf('} as const;', start);
    const block = source.slice(start, end);
    const codes = [...block.matchAll(/:\s*'([^']+)'/g)].map((match) => match[1] ?? '');
    expect(codes.length).toBeGreaterThan(20);
    for (const code of codes) {
      expect(API_ERROR_CODES).toContain(code);
      const status = code === 'not_found' ? 404 : 422;
      const key = copyKeyForApiError(code, status);
      expect(copyText(key)).toBe(COPY[key]);
      expect(copyText(key)).not.toContain('http');
    }
    expect(copyKeyForApiError('edited_value_invalid', 422)).toBe('ocr.edit.invalid');
    expect(copyKeyForApiError('field_already_set', 409)).toBe('ocr.conflict');
    expect(copyKeyForApiError('not_a_real_code', 422)).toBe('common.error');
  });

  it('treats a 302 to a foreign host as a redirect and does not leak or retry it', async () => {
    const access = 'access-secret-7f3a';
    const idem = v4(9);
    const bodyMarker = 'body-secret-7f3a';
    let textReads = 0;
    const seen: Array<{ url: string; redirect?: RequestRedirect; authorization: string }> = [];
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4010',
      env: 'test',
      tokenStore: memoryStore({ accessToken: access, refreshToken: 'refresh-secret-7f3a' }),
      randomUUID: () => idem,
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/v1/health')) {
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
        }
        seen.push({
          url,
          redirect: init?.redirect,
          authorization: new Headers(init?.headers).get('authorization') ?? '',
        });
        return {
          status: 302,
          type: 'default',
          url: 'https://evil.example/collect',
          headers: new Headers({ location: 'https://evil.example/collect' }),
          text: async () => {
            textReads += 1;
            return `leaked ${access} ${idem} ${bodyMarker}`;
          },
        } as Response;
      },
    });
    const error = await client
      .createPayment(PROPERTY_ID, { ...paymentInput(), obligationId: OBLIGATION_ID, notes: bodyMarker })
      .then(
        () => {
          throw new Error('expected a rejection');
        },
        (caught: unknown) => caught,
      );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url.startsWith('http://127.0.0.1:4010/')).toBe(true);
    expect(seen[0]?.redirect).toBe('manual');
    expect(seen[0]?.authorization).toBe(`Bearer ${access}`);
    expect(textReads).toBe(0);
    expect(error).toMatchObject({ code: 'redirect', message: COPY['common.connecting.failed'] });
    expect((error as Error).message).not.toContain(access);
    expect((error as Error).message).not.toContain(bodyMarker);
    expect((error as Error).message).not.toContain('evil.example');
    expect((error as Error).message).not.toMatch(/sesión expirada/i);
    expect(JSON.stringify(error)).not.toContain('evil.example');

    seen.length = 0;
    const reads = createApiClient({
      baseUrl: 'http://127.0.0.1:4010',
      env: 'test',
      tokenStore: memoryStore({ accessToken: access, refreshToken: 'refresh-secret-7f3a' }),
      fetchImpl: async (input, init) => {
        seen.push({
          url: String(input),
          redirect: init?.redirect,
          authorization: new Headers(init?.headers).get('authorization') ?? '',
        });
        return { status: 302, type: 'opaqueredirect', url: 'https://evil.example/collect', text: async () => '' } as Response;
      },
    });
    await expect(reads.getProperty(PROPERTY_ID)).rejects.toMatchObject({ code: 'redirect' });
    expect(seen).toHaveLength(1);
  });

  it('reuses A key after B succeeds when Reintentar is tapped on A', async () => {
    jest.useFakeTimers();
    try {
      let minted = 0;
      const { server, client } = setup({
        randomUUID: () => {
          minted += 1;
          return v4(minted);
        },
      });
      const keys: Array<{ amount: string; key: string }> = [];
      const attempts = new Map<string, number>();
      server.route('POST', PAYMENT_PATH, (request) => {
        const parsed = JSON.parse(request.bodyText ?? '{}') as { amount: string; paidAt: string };
        const amount = parsed.amount;
        const seen = (attempts.get(amount) ?? 0) + 1;
        attempts.set(amount, seen);
        keys.push({ amount, key: request.headers['idempotency-key'] ?? '' });
        if (amount === '10.00' && seen === 1) {
          return { status: 201, hang: true };
        }
        return { status: 201, body: paymentCreated(parsed.amount, parsed.paidAt) };
      });
      let caught: { idempotencyKey?: string } | undefined;
      const pending = client.createPayment(PROPERTY_ID, paymentInput('2026-10-29', '10.00')).then(
        () => undefined,
        (error: { idempotencyKey?: string }) => {
          caught = error;
        },
      );
      await flushMicrotasks();
      await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await pending;
      expect(caught?.idempotencyKey).toBe(v4(1));
      await client.createPayment(PROPERTY_ID, paymentInput('2026-10-29', '11.00'));
      await client.createPayment(PROPERTY_ID, paymentInput('2026-10-29', '10.00'));
      await client.createPayment(PROPERTY_ID, paymentInput('2026-10-29', '12.00'));
      const keyFor = (amount: string) => keys.filter((item) => item.amount === amount).map((item) => item.key);
      expect(keyFor('10.00')).toEqual([v4(1), v4(1)]);
      expect(keyFor('11.00')).toEqual([v4(2)]);
      expect(keyFor('12.00')).toEqual([v4(3)]);
      expect(minted).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('resends a write once after refresh and does not retry if that resend fails', async () => {
    const { server, client } = setup();
    const keys: string[] = [];
    let posts = 0;
    server.route('POST', REFRESH_PATH, () => ({
      status: 200,
      body: { accessToken: 'access-2', refreshToken: 'refresh-2' },
    }));
    server.route('POST', PAYMENT_PATH, (request) => {
      posts += 1;
      keys.push(request.headers['idempotency-key'] ?? '');
      return { status: 401, body: { statusCode: 401, error: 'token_expired', message: 'Token expired.' } };
    });
    await expect(client.createPayment(PROPERTY_ID, paymentInput())).rejects.toMatchObject({ status: 401 });
    expect(posts).toBe(2);
    expect(keys[0]).toBe(keys[1]);
    expect(server.calls('POST', REFRESH_PATH)).toHaveLength(1);
  });

  it('keeps the session when the token store cannot be read and sends no request', async () => {
    let clears = 0;
    const calls: string[] = [];
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4010',
      env: 'test',
      tokenStore: {
        async read() {
          throw new TokenStoreUnavailableError();
        },
        async save() {
          return undefined;
        },
        async clear() {
          clears += 1;
        },
      },
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(JSON.stringify(propertyFixture), { status: 200 });
      },
    });
    const error = await client.getProperty(PROPERTY_ID).then(
      () => {
        throw new Error('expected a rejection');
      },
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      code: 'connecting_failed',
      copyKey: 'common.connecting.failed',
      message: COPY['common.connecting.failed'],
      retryLabel: 'Reintentar',
    });
    expect((error as Error).message).not.toMatch(/sesión expirada|sign-out|cerrar sesión/i);
    expect(clears).toBe(0);
    expect(calls).toEqual([]);
  });

  it('retries a rotated token save once and does not wipe the session if it still fails', async () => {
    const { server, tokens } = setup();
    let saves = 0;
    let clears = 0;
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4010',
      env: 'test',
      tokenStore: {
        async read() {
          return tokens.current();
        },
        async save() {
          saves += 1;
          throw new Error('disk');
        },
        async clear() {
          clears += 1;
        },
      },
      fetchImpl: server.fetch,
    });
    server.route('GET', PROPERTY_PATH, (request) => {
      if (request.headers.authorization === 'Bearer access-2') {
        return { status: 200, body: propertyFixture };
      }
      return { status: 401, body: { statusCode: 401, error: 'token_expired', message: 'Token expired.' } };
    });
    server.route('POST', REFRESH_PATH, () => ({
      status: 200,
      body: { accessToken: 'access-2', refreshToken: 'refresh-2' },
    }));
    const error = await client.getProperty(PROPERTY_ID).then(
      () => {
        throw new Error('expected a rejection');
      },
      (caught: unknown) => caught,
    );
    expect(saves).toBe(2);
    expect(clears).toBe(0);
    expect(tokens.current()).toEqual({ accessToken: ACCESS, refreshToken: REFRESH });
    expect(error).toMatchObject({
      code: 'connecting_failed',
      message: COPY['common.connecting.failed'],
      retryLabel: 'Reintentar',
    });
    expect((error as Error).message).not.toMatch(/sesión expirada/i);
  });

  it('ends the session only for a refresh 401 or a 400 with a refresh error code', async () => {
    const kept = setup();
    const keptEvents: string[] = [];
    kept.client.subscribe((event) => {
      keptEvents.push(event.type);
    });
    kept.server.route('GET', PROPERTY_PATH, () => ({
      status: 401,
      body: { statusCode: 401, error: 'token_expired', message: 'Token expired.' },
    }));
    kept.server.route('POST', REFRESH_PATH, () => ({
      status: 400,
      body: { statusCode: 400, error: 'idempotency_key_invalid', message: 'no' },
    }));
    await expect(kept.client.getProperty(PROPERTY_ID)).rejects.toMatchObject({
      code: 'auth.unavailable',
      copyKey: 'common.connecting.failed',
    });
    expect(kept.tokens.current()).toEqual({ accessToken: ACCESS, refreshToken: REFRESH });
    expect(keptEvents).toEqual([]);

    const ended = setup();
    const endedEvents: string[] = [];
    ended.client.subscribe((event) => {
      endedEvents.push(event.type);
    });
    ended.server.route('GET', PROPERTY_PATH, () => ({
      status: 401,
      body: { statusCode: 401, error: 'token_expired', message: 'Token expired.' },
    }));
    ended.server.route('POST', REFRESH_PATH, () => ({
      status: 400,
      body: { statusCode: 400, error: 'auth.refresh_invalid', message: 'The refresh token is not valid.' },
    }));
    await expect(ended.client.getProperty(PROPERTY_ID)).rejects.toMatchObject({ code: 'sign_in_required' });
    expect(ended.tokens.current()).toBeNull();
    expect(endedEvents).toEqual(['sign-in-required']);
    expect((endedEvents.join(' '))).not.toMatch(/sesión expirada/i);
  });

  it('attaches Authorization only when the request origin is the API origin', () => {
    expect(mayAttachAuthorization('http://127.0.0.1:4010/v1/me', 'http://127.0.0.1:4010')).toBe(true);
    expect(mayAttachAuthorization('https://evil.example/v1/me', 'http://127.0.0.1:4010')).toBe(false);
  });

  it('uses expo/fetch and ignores a switch back to the React Native fetch', () => {
    const source = fs.readFileSync(path.join(__dirname, 'client.ts'), 'utf8');
    expect(source).toContain("from 'expo/fetch'");
    expect(source).not.toContain('globalThis.fetch');
    const marker = ['EXPO', 'PUBLIC', 'USE_RN_FETCH'].join('_');
    expect(process.env[marker]).toBeFalsy();
    expect(source.includes(marker)).toBe(false);
  });

  it('never writes tokens outside SecureStore', () => {
    const root = path.join(__dirname, '../..');
    const files = walkProduction(path.join(root, 'src')).concat([
      path.join(root, 'App.tsx'),
      path.join(root, 'index.ts'),
      path.join(root, 'app.json'),
    ]);
    const offenders = files.filter((file) =>
      /AsyncStorage|@react-native-async-storage/.test(codeWithoutComments(read(file))),
    );
    expect(offenders).toEqual([]);
    const clientSource = read(path.join(root, 'src/api/client.ts'));
    expect(clientSource).not.toContain('expo-secure-store');
    expect(clientSource).not.toContain('AsyncStorage');
    const storeSource = read(path.join(root, 'src/auth/tokenStore.ts'));
    expect(storeSource).toContain("from 'expo-secure-store'");
    expect(storeSource).toContain('export interface TokenStore');
  });
});

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

function walkProduction(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === '.expo') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkProduction(full, acc);
    } else if (/\.(ts|tsx|js|json)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}
