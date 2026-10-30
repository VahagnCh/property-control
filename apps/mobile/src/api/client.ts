import { fetch as expoFetch } from 'expo/fetch';
import type { AuthTokens, TokenStore } from '../auth/tokenStore';
import { TokenStoreUnavailableError } from '../auth/tokenStore';
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

const REFRESH_END_CODES = new Set([
  'auth.refresh_invalid',
  'auth.refresh_reused',
  'token_invalid',
  'token_expired',
]);

/** True only when the request URL is the configured API origin. */
export function mayAttachAuthorization(requestUrl: string, baseUrl: string): boolean {
  try {
    return new URL(requestUrl).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

/** EC-11.2: a write calls GET /v1/health only after this long with no API response. */
export const HEALTH_STALE_MS = 10 * 60 * 1000;

type PendingWrite = {
  key: string;
};

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
  private readonly pendingWrites = new Map<string, PendingWrite>();
  private readonly sessionListeners = new Set<(event: ApiClientEvent) => void>();
  private readonly connectionListeners = new Set<(snapshot: ConnectionSnapshot) => void>();

  constructor(options: ApiClientOptions) {
    this.baseUrl = readApiBaseUrl(options.baseUrl, options.env);
    this.tokenStore = options.tokenStore;
    this.fetchImpl = options.fetchImpl ?? expoFetch;
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
    options?: { body?: unknown },
  ): Promise<T> {
    if (this.signedOut) {
      throw new SessionExpiredError();
    }
    const write = isWriteMethod(method) && path !== REFRESH_PATH;
    assertDecimalMoney(options?.body);
    const idempotencyKey = write ? this.keyForWrite(method, path, options?.body) : null;
    const transport = write ? this.send.bind(this) : this.sendRead.bind(this);
    try {
      if (write) {
        await this.ensureFresh();
      }
      if (this.signedOut) {
        throw new SessionExpiredError();
      }
      const sent = {
        method,
        path,
        body: options?.body,
        auth: path !== HEALTH_PATH,
        idempotencyKey,
      };
      const first = await transport(sent);
      if (first.status !== 401 || path === HEALTH_PATH) {
        if (write) {
          this.noteWriteResponse(method, path, options?.body, first);
        }
        return this.finish<T>(first);
      }
      await this.refresh();
      const second = await transport(sent);
      if (write) {
        this.noteWriteResponse(method, path, options?.body, second);
      }
      return this.finish<T>(second);
    } catch (error) {
      if (error instanceof TokenStoreUnavailableError) {
        throw new ConnectingFailedError(write ? idempotencyKey : null);
      }
      if (!write) {
        throw error;
      }
      if (error instanceof ConnectingFailedError || isUnreachable(error)) {
        throw new ConnectingFailedError(idempotencyKey);
      }
      throw error;
    }
  }

  getProperty(propertyId: string): Promise<PropertyResponse> {
    return this.request<PropertyResponse>('GET', `/v1/properties/${encodeURIComponent(propertyId)}`);
  }

  /**
   * `paidAt` as a Date is the property-zone calendar date, including 23:59
   * and 00:01 in America/Mexico_City. A string is sent as that calendar date.
   * The idempotency key stays with this path and canonical body after a
   * timeout, a network error, or a 5xx. A 2xx or a 4xx releases it.
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
      { body },
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
      const response = await this.sendRead({
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
        throw new ConnectingFailedError(null);
      }
      this.publish(IDLE_CONNECTION);
    } catch (error) {
      if (error instanceof ConnectingFailedError) {
        throw error;
      }
      this.publish({ phase: 'failed', label: null, copyKey: 'common.connecting.failed' });
      throw new ConnectingFailedError(null);
    }
  }

  /**
   * One refresh for every caller that arrives while it is in flight.
   * A network error is retried once with the same refresh token.
   * Only 400 and 401 clear the session. A 5xx, including auth.unavailable,
   * leaves the tokens in place.
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
    let current: AuthTokens | null;
    try {
      current = await this.tokenStore.read();
    } catch (error) {
      if (error instanceof TokenStoreUnavailableError) {
        throw new ConnectingFailedError(null);
      }
      throw error;
    }
    if (!current) {
      await this.endSession();
      throw new SessionExpiredError();
    }
    const refreshToken = current.refreshToken;
    let outcome = await this.postRefresh(refreshToken);
    if (outcome === 'network') {
      outcome = await this.postRefresh(refreshToken);
    }
    if (outcome === 'ok') {
      return;
    }
    if (outcome === 'rejected') {
      await this.endSession();
      throw new SessionExpiredError();
    }
    throw new ApiClientError('auth.unavailable', 'common.connecting.failed', 503);
  }

  private async postRefresh(refreshToken: string): Promise<'ok' | 'rejected' | 'unavailable' | 'network'> {
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
        await this.saveRotated(next);
        return 'ok';
      }
      const code = readErrorCode(response.body, response.status);
      if (response.status === 401 || (response.status === 400 && REFRESH_END_CODES.has(code))) {
        return 'rejected';
      }
      return 'unavailable';
    } catch (error) {
      if (error instanceof TokenStoreUnavailableError) {
        throw error;
      }
      if (isUnreachable(error)) {
        return 'network';
      }
      return 'unavailable';
    }
  }

  /** One retry of the rotated pair. A failed save does not clear the previous session. */
  private async saveRotated(tokens: AuthTokens): Promise<void> {
    try {
      await this.tokenStore.save(tokens);
    } catch {
      try {
        await this.tokenStore.save(tokens);
      } catch {
        throw new TokenStoreUnavailableError();
      }
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

  /**
   * EC-11.7. The key is the path plus a canonical body hash.
   * Timeout, network error, and 5xx keep it: the server does not store a 5xx
   * under the key, so a later Reintentar is a fresh attempt with the same key.
   * A definite 2xx or 4xx releases it. Writes are not retried automatically.
   */
  private keyForWrite(method: HttpMethod, path: string, body: unknown): string {
    const fingerprint = writeFingerprint(method, path, body);
    const pending = this.pendingWrites.get(fingerprint);
    if (pending) {
      return pending.key;
    }
    const key = this.randomUUID();
    if (!IDEMPOTENCY_KEY.test(key)) {
      throw new ApiClientError('idempotency_key_invalid', 'common.error', 400);
    }
    this.pendingWrites.set(fingerprint, { key });
    return key;
  }

  private noteWriteResponse(method: HttpMethod, path: string, body: unknown, response: WireResponse): void {
    const fingerprint = writeFingerprint(method, path, body);
    if (!this.pendingWrites.has(fingerprint)) {
      return;
    }
    if (
      (response.status >= 200 && response.status < 300) ||
      (response.status >= 400 && response.status < 500)
    ) {
      this.pendingWrites.delete(fingerprint);
    }
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

  /** GETs retry once after a timeout or network error. Writes do not. */
  private async sendRead(input: SendInput): Promise<WireResponse> {
    try {
      return await this.send(input);
    } catch (error) {
      if (!isUnreachable(error)) {
        throw error;
      }
      return await this.send(input);
    }
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
        if (!mayAttachAuthorization(url, this.baseUrl)) {
          throw new ApiClientError('invalid_path', 'common.error', null);
        }
        headers.Authorization = `Bearer ${tokens.accessToken}`;
      }
    }
    const timeout = startTimeout(REQUEST_TIMEOUT_MS);
    const pending = this.fetchImpl(url, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: timeout.signal,
      redirect: 'manual',
    });
    pending.catch(() => undefined);
    try {
      const response = await Promise.race([pending, timeout.promise]);
      if (isRedirect(response) || !responseStaysOnOrigin(response.url, this.baseUrl)) {
        throw new ApiClientError('redirect', 'common.connecting.failed', null);
      }
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

function isUnreachable(error: unknown): boolean {
  return error instanceof ApiClientError && (error.code === 'network' || error.code === 'timeout');
}

function isRedirect(response: { status: number; type?: string }): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
}

function responseStaysOnOrigin(responseUrl: string | undefined, baseUrl: string): boolean {
  if (!responseUrl) {
    return true;
  }
  try {
    return new URL(responseUrl).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function writeFingerprint(method: HttpMethod, path: string, body: unknown): string {
  return canonicalJson({ method, path, body: body ?? null });
}

function canonicalJson(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
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
