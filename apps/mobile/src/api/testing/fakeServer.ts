import {
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
    const raw = result.body === undefined ? '' : JSON.stringify(result.body);
    return new Response(raw, {
      status: result.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  };

  private installContractRoutes(): void {
    this.route('GET', '/v1/health', () => ({ status: 200, body: healthOk }));
    this.route('POST', REFRESH_PATH, (request) => refreshFromContract(request));
    this.route('GET', `/v1/properties/${PROPERTY_ID}`, () => ({ status: 200, body: propertyFixture }));
    this.route('POST', `/v1/properties/${PROPERTY_ID}/payments`, (request) => paymentFromContract(request));
  }
}

export function createContractFakeServer(): FakeServer {
  return new FakeServer();
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
