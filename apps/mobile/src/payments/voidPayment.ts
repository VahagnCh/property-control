export type MembershipRole = 'owner' | 'member' | 'viewer';

export type PaymentSnapshot = {
  id: string;
  status: 'recorded' | 'voided';
  amountCentavos: number;
  voidedAt: string | null;
  voidReason: string | null;
};

export const VOID_FORBIDDEN_MESSAGE = 'No tienes permiso para anular este pago';

export const VOID_NOT_FOUND_MESSAGE = 'No encontramos este pago.';

/** AC-PAY-21. Exact copy from UX spec v1.2 rev d. */
export const VOID_ALREADY_VOIDED_MESSAGE = 'Este pago ya estaba anulado.';

export type VoidPaymentRequest = {
  method: 'POST';
  path: string;
  body: { voidReason: string };
};

/** Viewers and non-members do not see Anular. Owners and members do. */
export function showAnular(role: MembershipRole | null): boolean {
  return role === 'owner' || role === 'member';
}

/**
 * A viewer who voids gets 403. A non-member gets 404.
 * Owners and members are allowed, so there is no denial status.
 */
export function voidDenialStatus(role: MembershipRole | null): 403 | 404 | null {
  if (role === 'owner' || role === 'member') {
    return null;
  }
  if (role === 'viewer') {
    return 403;
  }
  return 404;
}

export type VoidMapResult = {
  payment: PaymentSnapshot;
  message: string | null;
  /** True when the client should reload the payment, as on a second void. */
  refresh: boolean;
};

export function mapVoidResponse(payment: PaymentSnapshot, httpStatus: number): VoidMapResult {
  if (httpStatus === 403) {
    return { payment, message: VOID_FORBIDDEN_MESSAGE, refresh: false };
  }
  if (httpStatus === 404) {
    return { payment, message: VOID_NOT_FOUND_MESSAGE, refresh: false };
  }
  if (httpStatus === 409) {
    return { payment, message: VOID_ALREADY_VOIDED_MESSAGE, refresh: true };
  }
  return { payment, message: null, refresh: false };
}

/**
 * POST /v1/properties/:propertyId/payments/:paymentId/void
 * Body is only `{ voidReason }`.
 */
export function buildVoidPaymentRequest(
  propertyId: string,
  paymentId: string,
  reason: string,
): VoidPaymentRequest | { ok: false } {
  const validated = validateVoidReason(reason);
  if (!validated.ok) {
    return { ok: false };
  }
  return {
    method: 'POST',
    path: `/v1/properties/${encodeURIComponent(propertyId)}/payments/${encodeURIComponent(paymentId)}/void`,
    body: { voidReason: validated.reason },
  };
}

/** Trimmed length 1–500. Blank does not enable the confirm action. */
export function validateVoidReason(reason: string): { ok: true; reason: string } | { ok: false } {
  const trimmed = reason.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    return { ok: false };
  }
  return { ok: true, reason: trimmed };
}
