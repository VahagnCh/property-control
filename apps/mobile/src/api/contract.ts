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
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** 8–128 letters, digits, underscores, or hyphens. A UUID v4 passes. */
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

export const HEALTH_PATH = '/v1/health';

/**
 * Trust mints refresh tokens. This API does not. Login routes are not built,
 * so the client posts the stored refresh token here until Trust publishes
 * the path. The path is not a secret.
 */
export const REFRESH_PATH = '/v1/auth/refresh';

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

export type RefreshRequestBody = {
  refreshToken: string;
};

export type RefreshResponseBody = {
  accessToken: string;
  refreshToken: string;
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
