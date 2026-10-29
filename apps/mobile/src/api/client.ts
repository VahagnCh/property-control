import type { AuthTokens, TokenStore } from '../auth/tokenStore';
import { CONNECTING_LABEL } from '../copy/userFacing';
import { createIdempotencyKey } from '../outbox/idempotency';
import {
  HEALTH_PATH,
  IDEMPOTENCY_KEY,
  REFRESH_PATH,
  isWriteMethod,
  type HttpMethod,
  type PaymentCreateBody,
  type PaymentCreateResponse,
  type PaymentWire,
  type PropertyResponse,
  type RefreshResponseBody,
} from './contract';
import { readApiBaseUrl, type ApiRuntime } from './config';
import {
  ApiClientError,
  ConnectingFailedError,
  IdempotencyKeyReusedError,
  SessionExpiredError,
  copyKeyForApiError,
  readErrorCode,
} from './errors';
import { assertCalendarDate, assertDecimalMoney, canonicalPesoAmount, paidAtOnPropertyCalendar } from './money';

/** Every request, including health and refresh, aborts at 15 seconds. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** EC-11.2: a write calls GET /v1/health only after this long with no API response. */
export const HEALTH_STALE_MS = 10 * 60 * 1000;

export type IdempotencyIntent = { intent: 'reintentar'; key: string } | { intent: 'reenviar' };

export type ConnectionSnapshot = {
  phase: 'idle' | 'connecting' | 'failed';
  label: typeof CONNECTING_LABEL | null;
  copyKey: 'common.connecting.failed' | null;
};

export type ApiClientEvent = { type: 'sign-in-required' };

export type ApiClientOptions = {
  baseUrl: string;
  env: ApiRuntime;
  tokenStore: TokenStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
  randomUUID?: () => string;
};

type SendInput = {
  method: HttpMethod;
  path: string;
  body?: unknown;
  auth: boolean;
  idempotencyKey: string | null;
};

type WireResponse = {
  status: number;
  body: unknown;
};

const IDLE_CONNECTION: ConnectionSnapshot = {
  phase: 'idle',
  label: null,
  copyKey: null,
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly tokenStore: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly randomUUID: () => string;
  private lastResponseAt: number | null = null;
  private signedOut = false;
  private signInEmitted = false;
  private refreshInFlight: Promise<void> | null = null;
  private healthInFlight: Promise<void> | null = null;
  private connectionSnapshot: ConnectionSnapshot = IDLE_CONNECTION;
  private readonly sessionListeners = new Set<(event: ApiClientEvent) => void>();
  private readonly connectionListeners = new Set<(snapshot: ConnectionSnapshot) => void>();

  constructor(options: ApiClientOptions) {
    this.baseUrl = readApiBaseUrl(options.baseUrl, options.env);
    this.tokenStore = options.tokenStore;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => Date.now());
    this.randomUUID = options.randomUUID ?? createIdempotencyKey;
  }

  connection(): ConnectionSnapshot {
    return this.connectionSnapshot;
  }

  subscribe(listener: (event: ApiClientEvent) => void): () => void {
    this.sessionListeners.add(listener);
    return () => {
      this.sessionListeners.delete(listener);
    };
  }

  subscribeConnection(listener: (snapshot: ConnectionSnapshot) => void): () => void {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  async request<T>(
    method: HttpMethod,
    path: string,
    options?: { body?: unknown; idempotency?: IdempotencyIntent },
  ): Promise<T> {
    if (this.signedOut) {
      throw new SessionExpiredError();
    }
    const write = isWriteMethod(method) && path !== REFRESH_PATH;
    assertDecimalMoney(options?.body);
    const idempotencyKey = write ? this.resolveKey(options?.idempotency) : null;
    if (write) {
      await this.ensureFresh();
    }
    if (this.signedOut) {
      throw new SessionExpiredError();
    }
    const first = await this.send({
      method,
      path,
      body: options?.body,
      auth: path !== HEALTH_PATH,
      idempotencyKey,
    });
    if (first.status !== 401 || path === HEALTH_PATH) {
      return this.finish<T>(first);
    }
    await this.refresh();
    const second = await this.send({
      method,
      path,
      body: options?.body,
      auth: true,
      idempotencyKey,
    });
    return this.finish<T>(second);
  }

  getProperty(propertyId: string): Promise<PropertyResponse> {
    return this.request<PropertyResponse>('GET', `/v1/properties/${encodeURIComponent(propertyId)}`);
  }

  /**
   * `paidAt` as a Date is the property-zone calendar date, including 23:59
   * and 00:01 in America/Mexico_City. A string is sent as that calendar date.
   * Reintentar reuses `key`. Reenviar mints a new one.
   */
  async createPayment(
    propertyId: string,
    input: {
      obligationId: string;
      amount: string;
      paidAt: Date | string;
      timeZone?: string;
      periodDueDate?: string;
      markPartial?: boolean;
      method?: string;
      reference?: string;
      notes?: string;
    },
    idempotency?: IdempotencyIntent,
  ): Promise<PaymentCreateResponse> {
    const paidAt =
      typeof input.paidAt === 'string'
        ? assertCalendarDate(input.paidAt)
        : paidAtOnPropertyCalendar(input.paidAt, input.timeZone);
    const body: PaymentCreateBody = {
      obligationId: input.obligationId,
      amount: canonicalPesoAmount(input.amount),
      currency: 'MXN',
      paidAt,
    };
    if (input.periodDueDate !== undefined) {
      body.periodDueDate = input.periodDueDate;
    }
    if (input.markPartial !== undefined) {
      body.markPartial = input.markPartial;
    }
    if (input.method !== undefined) {
      body.method = input.method;
    }
    if (input.reference !== undefined) {
      body.reference = input.reference;
    }
    if (input.notes !== undefined) {
      body.notes = input.notes;
    }
    const response = await this.request<PaymentCreateResponse>(
      'POST',
      `/v1/properties/${encodeURIComponent(propertyId)}/payments`,
      { body, idempotency },
    );
    return readPaymentResponse(response);
  }

  private async ensureFresh(): Promise<void> {
    if (!this.needsHealth()) {
      return;
    }
    if (!this.healthInFlight) {
      this.healthInFlight = this.healthOnce().finally(() => {
        this.healthInFlight = null;
      });
    }
    await this.healthInFlight;
  }

  private needsHealth(): boolean {
    if (this.lastResponseAt === null) {
      return true;
    }
    return this.now() - this.lastResponseAt > HEALTH_STALE_MS;
  }

  private async healthOnce(): Promise<void> {
    this.publish({ phase: 'connecting', label: CONNECTING_LABEL, copyKey: null });
    try {
      const response = await this.send({
        method: 'GET',
        path: HEALTH_PATH,
        auth: false,
        idempotencyKey: null,
      });
      const ok =
        response.status === 200 &&
        !!response.body &&
        typeof response.body === 'object' &&
        (response.body as { status?: unknown }).status === 'ok';
      if (!ok) {
        this.publish({ phase: 'failed', label: null, copyKey: 'common.connecting.failed' });
        throw new ConnectingFailedError();
      }
      this.publish(IDLE_CONNECTION);
    } catch (error) {
      if (error instanceof ConnectingFailedError) {
        throw error;
      }
      this.publish({ phase: 'failed', label: null, copyKey: 'common.connecting.failed' });
      throw new ConnectingFailedError();
    }
  }

  /**
   * One refresh for every caller that arrives while it is in flight.
   * A 4xx is not retried. A network error is retried once, with the same
   * refresh token. Failure clears the session and emits sign-in-required.
   */
  private refresh(): Promise<void> {
    if (this.signedOut) {
      return Promise.reject(new SessionExpiredError());
    }
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshOnce().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  private async refreshOnce(): Promise<void> {
    const current = await this.tokenStore.read();
    if (!current) {
      await this.endSession();
      throw new SessionExpiredError();
    }
    const refreshToken = current.refreshToken;
    const first = await this.postRefresh(refreshToken);
    if (first === 'ok') {
      return;
    }
    if (first !== 'network') {
      await this.endSession();
      throw new SessionExpiredError();
    }
    const second = await this.postRefresh(refreshToken);
    if (second === 'ok') {
      return;
    }
    await this.endSession();
    throw new SessionExpiredError();
  }

  private async postRefresh(refreshToken: string): Promise<'ok' | 'http' | 'network'> {
    try {
      const response = await this.send({
        method: 'POST',
        path: REFRESH_PATH,
        body: { refreshToken },
        auth: false,
        idempotencyKey: null,
      });
      if (response.status >= 200 && response.status < 300) {
        const next = readRefreshPair(response.body);
        await this.tokenStore.save(next);
        return 'ok';
      }
      if (response.status >= 400 && response.status < 500) {
        return 'http';
      }
      return 'http';
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'network') {
        return 'network';
      }
      return 'http';
    }
  }

  private async endSession(): Promise<void> {
    this.signedOut = true;
    await this.tokenStore.clear();
    if (this.signInEmitted) {
      return;
    }
    this.signInEmitted = true;
    const event: ApiClientEvent = { type: 'sign-in-required' };
    for (const listener of [...this.sessionListeners]) {
      listener(event);
    }
  }

  private resolveKey(intent: IdempotencyIntent | undefined): string {
    const key = intent?.intent === 'reintentar' ? intent.key : this.randomUUID();
    if (!IDEMPOTENCY_KEY.test(key)) {
      throw new ApiClientError('idempotency_key_invalid', 'common.error', 400);
    }
    return key;
  }

  private finish<T>(response: WireResponse): T {
    if (response.status >= 200 && response.status < 300) {
      return response.body as T;
    }
    const code = readErrorCode(response.body, response.status);
    if (response.status === 409 && code === 'idempotency_key_reused') {
      throw new IdempotencyKeyReusedError();
    }
    throw new ApiClientError(code, copyKeyForApiError(code, response.status), response.status);
  }

  private async send(input: SendInput): Promise<WireResponse> {
    const url = resolveUrl(this.baseUrl, input.path);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (input.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (input.idempotencyKey) {
      headers['Idempotency-Key'] = input.idempotencyKey;
    }
    if (input.auth) {
      const tokens = await this.tokenStore.read();
      if (tokens?.accessToken) {
        headers.Authorization = `Bearer ${tokens.accessToken}`;
      }
    }
    const timeout = startTimeout(REQUEST_TIMEOUT_MS);
    const pending = this.fetchImpl(url, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: timeout.signal,
    });
    pending.catch(() => undefined);
    try {
      const response = await Promise.race([pending, timeout.promise]);
      this.lastResponseAt = this.now();
      const text = await response.text();
      return { status: response.status, body: parseJson(text) };
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }
      if (timeout.fired() || isAbortError(error)) {
        throw new ApiClientError('timeout', 'common.error', null);
      }
      throw new ApiClientError('network', 'common.error', null);
    } finally {
      timeout.cancel();
    }
  }

  private publish(snapshot: ConnectionSnapshot): void {
    this.connectionSnapshot = Object.freeze({ ...snapshot });
    for (const listener of [...this.connectionListeners]) {
      listener(this.connectionSnapshot);
    }
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}

function resolveUrl(baseUrl: string, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
    throw new ApiClientError('invalid_path', 'common.error', null);
  }
  return `${baseUrl}${path}`;
}

function parseJson(text: string): unknown {
  if (text.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function readRefreshPair(body: unknown): AuthTokens {
  if (!body || typeof body !== 'object') {
    throw new ApiClientError('token_invalid', 'common.error', null);
  }
  const accessToken = (body as RefreshResponseBody).accessToken;
  const refreshToken = (body as RefreshResponseBody).refreshToken;
  if (typeof accessToken !== 'string' || accessToken === '' || typeof refreshToken !== 'string' || refreshToken === '') {
    throw new ApiClientError('token_invalid', 'common.error', null);
  }
  return { accessToken, refreshToken };
}

function readPaymentResponse(body: PaymentCreateResponse): PaymentCreateResponse {
  const amount = body?.payment?.amount;
  if (typeof amount !== 'string') {
    throw new ApiClientError('amount_invalid', 'common.error', null);
  }
  const payment: PaymentWire = {
    ...body.payment,
    amount: canonicalPesoAmount(amount),
    currency: 'MXN',
  };
  return { payment, warnings: Array.isArray(body.warnings) ? body.warnings : [] };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function startTimeout(ms: number): {
  signal: AbortSignal;
  promise: Promise<never>;
  cancel: () => void;
  fired: () => boolean;
} {
  const controller = new AbortController();
  let fired = false;
  let rejectPromise: (error: ApiClientError) => void = () => undefined;
  const promise = new Promise<never>((_, reject) => {
    rejectPromise = reject;
  });
  promise.catch(() => undefined);
  const timer = setTimeout(() => {
    fired = true;
    controller.abort();
    rejectPromise(new ApiClientError('timeout', 'common.error', null));
  }, ms);
  return {
    signal: controller.signal,
    promise,
    fired: () => fired,
    cancel() {
      clearTimeout(timer);
      if (!fired) {
        rejectPromise(new ApiClientError('timeout', 'common.error', null));
      }
    },
  };
}
