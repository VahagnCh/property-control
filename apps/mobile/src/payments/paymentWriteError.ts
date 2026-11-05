import { copyText, type CopyKey } from '../copy/userFacing';

export type PaymentWriteNotice = {
  copyKey: CopyKey;
  message: string;
  cta: string | null;
  /** already_voided reloads the receipt immediately and shows it as anulado. */
  refreshOnMount: boolean;
  hideWrites: boolean;
  voidedLabel: string | null;
};

/**
 * 409 payment_voided keeps Editar and Anular hidden and offers Ver pago.
 * 409 already_voided uses the same hide, refreshes, and labels the receipt anulado.
 * 409 conflict is a non-failure notice. 403 forbidden hides writes.
 * 404 for a foreign id is not-found.
 */
export function mapPaymentWriteError(
  status: number,
  code: string,
  action: 'record' | 'void' = 'record',
): PaymentWriteNotice | null {
  if (status === 409 && code === 'payment_voided') {
    return {
      copyKey: 'pay.void.noEdit',
      message: copyText('pay.void.noEdit'),
      cta: copyText('pay.void.noEdit.cta'),
      refreshOnMount: false,
      hideWrites: true,
      voidedLabel: null,
    };
  }
  if (status === 409 && code === 'already_voided') {
    return {
      copyKey: 'pay.void.alreadyVoided',
      message: copyText('pay.void.alreadyVoided'),
      cta: null,
      refreshOnMount: true,
      hideWrites: true,
      voidedLabel: copyText('pay.void.badge'),
    };
  }
  if (status === 409 && code === 'conflict') {
    return {
      copyKey: 'pay.sync.conflict',
      message: copyText('pay.sync.conflict'),
      cta: null,
      refreshOnMount: false,
      hideWrites: false,
      voidedLabel: null,
    };
  }
  if (status === 403 && (code === 'forbidden' || code === 'viewer')) {
    const copyKey = action === 'void' ? 'pay.void.forbidden' : 'err.forbidden';
    return {
      copyKey,
      message: copyText(copyKey),
      cta: null,
      refreshOnMount: false,
      hideWrites: true,
      voidedLabel: null,
    };
  }
  if (status === 404 || code === 'not_found') {
    return {
      copyKey: 'err.notFound',
      message: copyText('err.notFound'),
      cta: copyText('err.notFound.cta'),
      refreshOnMount: false,
      hideWrites: true,
      voidedLabel: null,
    };
  }
  return null;
}
