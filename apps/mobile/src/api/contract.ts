/**
 * Client view of the v1 HTTP contract in docs/API.md, the property DTO in
 * apps/api/src/properties/property.response.ts, wire money in
 * apps/api/src/payments/wire-money.ts, and the stable `error` codes from
 * apps/api/src/ocr/ocr-errors.ts (PR #5) plus the other codes documented
 * on the API. The mobile package does not import the API build.
 */

export const API_ERROR_CODES = [
  'token_missing',
  'token_invalid',
  'token_expired',
  'invalid_path',
  'invalid_json',
  'payload_too_large',
  'not_found',
  'forbidden',
  'ocr_disabled',
  'ocr_capacity',
  'job_expired',
  'job_not_confirmable',
  'decisions_invalid',
  'unknown_field',
  'suggestion_invalid',
  'action_invalid',
  'edited_value_required',
  'target_invalid',
  'duplicate_decision',
  'missing_decision',
  'client_prior_value_rejected',
  'bulk_accept_rejected',
  'edited_value_invalid',
  'bound_target_immutable',
  'target_required',
  'target_voided',
  'target_status_unknown',
  'target_not_writable',
  'field_already_set',
  'field_path_unknown',
  'invalid_source_key',
  'saved_value_conflict',
  'next_due_date_out_of_range',
  'idempotency_key_invalid',
  'idempotency_key_mismatch',
  'idempotency_key_reused',
  'idempotency_in_progress',
  'payment_voided',
  'already_voided',
  'conflict',
  'consent_required',
  'viewer',
  'rate_limited',
  'aviso_version_mismatch',
  'aviso_unavailable',
  'paid_at_out_of_range',
  'invalid_timezone',
  'invalid_stored_timezone',
  'evidence.too_large',
  'not_implemented',
  'amount_invalid',
  'auth.email_invalid',
  'auth.code_invalid',
  'auth.rate_limited',
  'auth.refresh_invalid',
  'auth.refresh_reused',
  'auth.unavailable',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** UUID v4. The only Idempotency-Key this client sends. */
export const IDEMPOTENCY_KEY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const HEALTH_PATH = '/v1/health';

/**
 * Email-code session routes from docs/API.md.
 * `POST /v1/auth/code` accepts an optional Idempotency-Key.
 * `POST /v1/auth/verify` does not. A 401 `auth.code_invalid` is not a refresh.
 */
export const AUTH_CODE_PATH = '/v1/auth/code';
export const AUTH_VERIFY_PATH = '/v1/auth/verify';
export const AUTH_LOGOUT_PATH = '/v1/auth/logout';
export const AUTH_SESSION_PATH = '/v1/auth/session';
export const REFRESH_PATH = '/v1/auth/refresh';

/** Documented resend cooldown. A 202 does not include Retry-After. */
export const AUTH_RESEND_COOLDOWN_SECONDS = 60;

/** A login code is valid for 10 minutes from the accepted request. */
export const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

export const AUTH_ACCESS_EXPIRES_IN = 900;

export const AUTH_CODE_ACCEPTED_MESSAGE = 'Si el correo es válido, te enviamos un código.';

export type HealthBody = { status: 'ok' } | { status: 'unavailable' };

export type ApiErrorBody = {
  statusCode: number;
  error: string;
  message: string;
  suggestionId?: string;
  field?: string;
};

export type PropertyType = 'house' | 'apartment' | 'land' | 'commercial' | 'other';

export type OccupancyStatus = 'owned' | 'rented' | 'family' | 'investment';

export type PropertyResponse = {
  id: string;
  name: string;
  propertyType: PropertyType;
  occupancyStatus: OccupancyStatus | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  country: string;
  postalCode: string | null;
  timezone: string;
  createdAt: string;
  updatedAt: string;
};

/** Create and patch body from docs/API.md. Omitted timezone defaults on the server. */
export type PropertyWriteBody = {
  name: string;
  propertyType?: PropertyType;
  occupancyStatus?: OccupancyStatus;
  addressLine?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  timezone?: string;
};

export type PropertyListResponse = {
  items: PropertyResponse[];
};

export type ObligationCategory =
  | 'predial'
  | 'water'
  | 'electricity'
  | 'gas'
  | 'internet'
  | 'mantenimiento'
  | 'mortgage'
  | 'insurance'
  | 'security'
  | 'other';

export type ObligationRecurrence =
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual'
  | 'custom'
  | 'irregular';

/** Obligation create body from docs/API.md. expectedAmount is a decimal peso string. */
export type ObligationWriteBody = {
  category: ObligationCategory;
  title: string;
  providerName?: string;
  recurrence?: ObligationRecurrence;
  dueDay?: number;
  scheduleAnchor?: string;
  nextDueDate?: string;
  expectedAmount?: string;
  reminderOffsets?: number[];
  preferredMethod?: string;
  notes?: string;
  isActive?: boolean;
};

export type ObligationResponse = {
  id: string;
  category: ObligationCategory;
  title: string;
  providerName?: string | null;
  recurrence?: ObligationRecurrence | null;
  dueDay?: number | null;
  scheduleAnchor?: string | null;
  nextDueDate?: string | null;
  expectedAmount?: string | null;
  reminderOffsets?: number[] | null;
  preferredMethod?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

export type ObligationListResponse = {
  items: ObligationResponse[];
};

export type RefreshRequestBody = {
  refreshToken: string;
};

export type RefreshResponseBody = {
  accessToken: string;
  refreshToken: string;
};

export type AuthCodeRequestBody = {
  email: string;
};

export type AuthVerifyRequestBody = {
  email: string;
  code: string;
};

export type AuthTokenResponseBody = {
  tokenType: 'Bearer';
  accessToken: string;
  expiresIn: 900;
  refreshToken: string;
};

export type AuthSessionBody = {
  sub: string;
  sid: string;
};

/** Decimal peso string plus MXN. Never a JSON number. */
export type PaymentCreateBody = {
  obligationId: string;
  amount: string;
  currency: 'MXN';
  paidAt: string;
  periodDueDate?: string;
  markPartial?: boolean;
  method?: string;
  reference?: string;
  notes?: string;
};

export type PaymentWire = {
  id: string;
  propertyId: string;
  obligationId: string;
  amount: string;
  currency: 'MXN';
  paidAt: string;
  status: 'recorded' | 'voided';
};

export type PaymentCreateResponse = {
  payment: PaymentWire;
  warnings: Array<{ code: 'possible_duplicate' }>;
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export function isWriteMethod(method: HttpMethod): boolean {
  return method !== 'GET';
}
