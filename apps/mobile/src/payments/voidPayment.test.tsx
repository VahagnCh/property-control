import { screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { VoidAction, VoidErrorText } from './VoidAction';
import { renderWithSafeArea } from '../test/renderTabs';
import {
  buildVoidPaymentRequest,
  mapVoidResponse,
  PaymentSnapshot,
  showAnular,
  validateVoidReason,
  VOID_ALREADY_VOIDED_MESSAGE,
  VOID_FORBIDDEN_MESSAGE,
  VOID_NOT_FOUND_MESSAGE,
  voidDenialStatus,
} from './voidPayment';

const recorded: PaymentSnapshot = {
  id: 'pay-1',
  status: 'recorded',
  amountCentavos: 123450,
  voidedAt: null,
  voidReason: null,
};

describe('void permissions', () => {
  it('hides Anular for viewers and non-members and shows it for owner and member', () => {
    expect(showAnular('viewer')).toBe(false);
    expect(showAnular(null)).toBe(false);
    expect(showAnular('owner')).toBe(true);
    expect(showAnular('member')).toBe(true);
    expect(voidDenialStatus('viewer')).toBe(403);
    expect(voidDenialStatus(null)).toBe(404);
    expect(voidDenialStatus('owner')).toBeNull();
    expect(voidDenialStatus('member')).toBeNull();

    renderWithSafeArea(
      <View>
        <VoidAction role="viewer" />
        <VoidAction role={null} />
        <VoidAction role="owner" />
        <VoidAction role="member" />
      </View>,
    );
    expect(screen.queryByTestId('anular-viewer')).toBeNull();
    expect(screen.queryByTestId('anular-none')).toBeNull();
    expect(screen.getByTestId('anular-owner')).toBeTruthy();
    expect(screen.getByTestId('anular-member')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Anular' })).toHaveLength(2);
  });

  it('shows the viewer 403 message and leaves the payment unchanged', () => {
    const frozen = Object.freeze({ ...recorded });
    const result = mapVoidResponse(frozen, 403);
    expect(result.message).toBe('No tienes permiso para anular este pago');
    expect(result.message).toBe(VOID_FORBIDDEN_MESSAGE);
    expect(result.refresh).toBe(false);
    expect(result.payment).toBe(frozen);
    expect(result.payment).toEqual(recorded);

    renderWithSafeArea(<VoidErrorText status={403} payment={frozen} />);
    expect(screen.getByText('No tienes permiso para anular este pago')).toBeTruthy();
    expect(frozen.status).toBe('recorded');
    expect(frozen.voidedAt).toBeNull();
    expect(frozen.voidReason).toBeNull();
  });

  it('maps a non-member 404 without changing the payment', () => {
    const result = mapVoidResponse(recorded, 404);
    expect(result.message).toBe(VOID_NOT_FOUND_MESSAGE);
    expect(result.message).not.toBe(VOID_FORBIDDEN_MESSAGE);
    expect(result.refresh).toBe(false);
    expect(result.payment).toBe(recorded);
    expect(result.payment.status).toBe('recorded');
  });

  it('requires a trimmed void reason from 1 to 500 characters', () => {
    expect(validateVoidReason('')).toEqual({ ok: false });
    expect(validateVoidReason('   ')).toEqual({ ok: false });
    expect(validateVoidReason('  duplicado  ')).toEqual({ ok: true, reason: 'duplicado' });
    expect(validateVoidReason('a'.repeat(500))).toEqual({ ok: true, reason: 'a'.repeat(500) });
    expect(validateVoidReason(`  ${'a'.repeat(500)}  `)).toEqual({
      ok: true,
      reason: 'a'.repeat(500),
    });
    expect(validateVoidReason('a'.repeat(501))).toEqual({ ok: false });
    expect(validateVoidReason(`  ${'a'.repeat(501)}  `)).toEqual({ ok: false });
  });

  it('posts a void with only voidReason', () => {
    const request = buildVoidPaymentRequest('prop-1', 'pay-1', '  duplicado  ');
    expect(request).toEqual({
      method: 'POST',
      path: '/v1/properties/prop-1/payments/pay-1/void',
      body: { voidReason: 'duplicado' },
    });
    if (!('body' in request)) {
      throw new Error('expected a request');
    }
    expect(request.method).toBe('POST');
    expect(Object.keys(request.body)).toEqual(['voidReason']);
    expect(request.body).not.toHaveProperty('status');
    expect(buildVoidPaymentRequest('prop-1', 'pay-1', '   ')).toEqual({ ok: false });
    expect(buildVoidPaymentRequest('prop-1', 'pay-1', 'a'.repeat(501))).toEqual({ ok: false });
  });

  it('AC-PAY-21: a second void shows the already-voided copy and asks for a refresh', () => {
    const frozen = Object.freeze({ ...recorded });
    const result = mapVoidResponse(frozen, 409);
    expect(result.message).toBe('Este pago ya estaba anulado.');
    expect(result.message).toBe(VOID_ALREADY_VOIDED_MESSAGE);
    expect(result.refresh).toBe(true);
    expect(result.payment).toBe(frozen);
    expect(result.payment).toEqual(recorded);
    expect(frozen.status).toBe('recorded');
    expect(frozen.voidedAt).toBeNull();
    expect(frozen.voidReason).toBeNull();

    const alreadyVoided = Object.freeze({
      ...recorded,
      status: 'voided' as const,
      voidedAt: '2026-10-21T06:00:00.000Z',
      voidReason: 'duplicado',
    });
    const again = mapVoidResponse(alreadyVoided, 409);
    expect(again.payment).toBe(alreadyVoided);
    expect(again.refresh).toBe(true);
    expect(again.payment.status).toBe('voided');

    renderWithSafeArea(<VoidErrorText status={409} payment={frozen} />);
    expect(screen.getByText('Este pago ya estaba anulado.')).toBeTruthy();
    expect(screen.getByTestId('void-needs-refresh')).toBeTruthy();
  });
});
