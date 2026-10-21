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

export function mapVoidResponse(
  payment: PaymentSnapshot,
  httpStatus: number,
): { payment: PaymentSnapshot; message: string | null } {
  if (httpStatus === 403) {
    return { payment, message: VOID_FORBIDDEN_MESSAGE };
  }
  if (httpStatus === 404) {
    return { payment, message: VOID_NOT_FOUND_MESSAGE };
  }
  return { payment, message: null };
}

/** Trimmed length 1–500. Blank does not enable the confirm action. */
export function validateVoidReason(reason: string): { ok: true; reason: string } | { ok: false } {
  const trimmed = reason.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    return { ok: false };
  }
  return { ok: true, reason: trimmed };
}
