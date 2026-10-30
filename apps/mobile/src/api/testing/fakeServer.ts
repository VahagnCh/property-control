import {
  AUTH_CODE_ACCEPTED_MESSAGE,
  AUTH_CODE_PATH,
  AUTH_LOGOUT_PATH,
  AUTH_SESSION_PATH,
  AUTH_VERIFY_PATH,
  IDEMPOTENCY_KEY,
  REFRESH_PATH,
  type ApiErrorBody,
  type HttpMethod,
} from '../contract';
import {
  OBLIGATION_ID,
  PROPERTY_ID,
  healthOk,
  notFoundBody,
  paymentCreated,
  propertyFixture,
} from './fixtures';

/**
 * Fetch mock built from the v1 contract. Lives under src/api/testing so the
 * app bundle does not import it. Handlers return contract bodies; they do
 * not log tokens, idempotency keys, or payloads.
 */

export type RecordedRequest = {
  method: string;
  path: string;
  url: string;
  headers: Record<string, string>;
  bodyText: string | null;
};

export type RouteResult = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  delayMs?: number;
  hang?: boolean;
  networkError?: boolean;
};

type Handler = (request: RecordedRequest) => RouteResult | Promise<RouteResult>;

type Route = {
  method: string;
  path: string;
  handle: Handler;
};

const WIRE_AMOUNT = /^(?:0|[1-9]\d*)(?:\.\d{2})?$/;

export class FakeServer {
  readonly requests: RecordedRequest[] = [];
  private readonly routes: Route[] = [];

  constructor() {
    this.installContractRoutes();
  }

  route(method: HttpMethod, path: string, handle: Handler): void {
    this.routes.unshift({ method, path, handle });
  }

  calls(method: string, path: string): RecordedRequest[] {
    return this.requests.filter((request) => request.method === method && request.path === path);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);
    const recorded: RecordedRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: parsed.pathname,
      url,
      headers: headerMap(init?.headers),
      bodyText: typeof init?.body === 'string' ? init.body : null,
    };
    this.requests.push(recorded);
    const route = this.routes.find((item) => item.method === recorded.method && item.path === recorded.path);
    const result = route ? await route.handle(recorded) : { status: 404, body: notFoundBody };
    await applyTiming(result, init?.signal ?? undefined);
    if (result.networkError) {
      throw new TypeError('Failed to fetch');
    }
    const headers = {
      'cache-control': 'no-store',
      ...(result.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(result.headers ?? {}),
    };
    if (result.status === 204) {
      return new Response(null, { status: 204, headers });
    }
    const raw = result.body === undefined ? '' : JSON.stringify(result.body);
    return new Response(raw, {
      status: result.status,
      headers,
    });
  };

  private installContractRoutes(): void {
    this.route('GET', '/v1/health', () => ({ status: 200, body: healthOk }));
    this.route('POST', AUTH_CODE_PATH, () => ({
      status: 202,
      body: { message: AUTH_CODE_ACCEPTED_MESSAGE },
    }));
    this.route('POST', AUTH_VERIFY_PATH, (request) => verifyFromContract(request));
    this.route('POST', AUTH_LOGOUT_PATH, (request) => {
      if (!request.headers.authorization?.startsWith('Bearer ')) {
        return { status: 401, body: errorBody(401, 'token_missing', 'Missing token.') };
      }
      return { status: 204 };
    });
    this.route('GET', AUTH_SESSION_PATH, (request) => {
      if (!request.headers.authorization?.startsWith('Bearer ')) {
        return { status: 401, body: errorBody(401, 'token_missing', 'Missing token.') };
      }
      return { status: 200, body: { sub: 'user-1', sid: 'sid-1' } };
    });
    this.route('POST', REFRESH_PATH, (request) => refreshFromContract(request));
    this.route('GET', `/v1/properties/${PROPERTY_ID}`, () => ({ status: 200, body: propertyFixture }));
    this.route('POST', `/v1/properties/${PROPERTY_ID}/payments`, (request) => paymentFromContract(request));
  }
}

export function createContractFakeServer(): FakeServer {
  return new FakeServer();
}

function verifyFromContract(request: RecordedRequest): RouteResult {
  const parsed = parse(request.bodyText);
  const code =
    parsed && typeof parsed === 'object' && 'code' in parsed ? (parsed as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && /^\d{6}$/.test(code)) {
    return {
      status: 200,
      body: {
        tokenType: 'Bearer',
        accessToken: 'access-from-verify',
        expiresIn: 900,
        refreshToken: 'rt_from-verify',
      },
    };
  }
  return { status: 401, body: errorBody(401, 'auth.code_invalid', 'The code is not valid.') };
}

function refreshFromContract(request: RecordedRequest): RouteResult {
  const parsed = parse(request.bodyText);
  const refreshToken =
    parsed && typeof parsed === 'object' && 'refreshToken' in parsed
      ? (parsed as { refreshToken?: unknown }).refreshToken
      : undefined;
  if (typeof refreshToken !== 'string' || refreshToken === '') {
    return { status: 401, body: errorBody(401, 'token_invalid', 'Token is not accepted.') };
  }
  return {
    status: 200,
    body: { accessToken: 'rotated-access', refreshToken: 'rotated-refresh' },
  };
}

function paymentFromContract(request: RecordedRequest): RouteResult {
  const key = request.headers['idempotency-key'];
  if (!key || !IDEMPOTENCY_KEY.test(key)) {
    return {
      status: 400,
      body: errorBody(
        400,
        'idempotency_key_invalid',
        'Idempotency-Key must be 8 to 128 characters of letters, digits, underscores, or hyphens.',
      ),
    };
  }
  const parsed = parse(request.bodyText);
  const amount =
    parsed && typeof parsed === 'object' && 'amount' in parsed ? (parsed as { amount?: unknown }).amount : undefined;
  const currency =
    parsed && typeof parsed === 'object' && 'currency' in parsed
      ? (parsed as { currency?: unknown }).currency
      : undefined;
  if (typeof amount !== 'string' || !WIRE_AMOUNT.test(amount) || currency !== 'MXN') {
    return {
      status: 422,
      body: errorBody(422, 'amount_invalid', 'amount must be a decimal peso string.'),
    };
  }
  const paidAt =
    parsed && typeof parsed === 'object' && 'paidAt' in parsed ? (parsed as { paidAt?: unknown }).paidAt : undefined;
  const obligationId =
    parsed && typeof parsed === 'object' && 'obligationId' in parsed
      ? (parsed as { obligationId?: unknown }).obligationId
      : undefined;
  if (typeof paidAt !== 'string' || obligationId !== OBLIGATION_ID) {
    return { status: 400, body: errorBody(400, 'invalid_json', 'JSON body does not parse.') };
  }
  return { status: 201, body: paymentCreated(amount, paidAt) };
}

function errorBody(statusCode: number, error: string, message: string): ApiErrorBody {
  return { statusCode, error, message };
}

function parse(text: string | null): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function headerMap(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) {
    return out;
  }
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      out[key.toLowerCase()] = value;
    }
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      out[key.toLowerCase()] = value;
    }
  }
  return out;
}

function applyTiming(result: RouteResult, signal: AbortSignal | undefined): Promise<void> {
  if (!result.hang && !(result.delayMs && result.delayMs > 0)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      if (timer) {
        clearTimeout(timer);
      }
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = result.hang
      ? null
      : setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, result.delayMs ?? 0);
  });
}
