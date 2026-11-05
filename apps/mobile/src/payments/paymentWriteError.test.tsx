import { fireEvent, render, screen } from '@testing-library/react-native';
import { COPY, copyText } from '../copy/userFacing';
import { PaymentWriteNoticeView } from './PaymentWriteNotice';
import { mapPaymentWriteError } from './paymentWriteError';

describe('payment write errors', () => {
  it('hides Editar and Anular pago when the payment is already voided', () => {
    render(<PaymentWriteNoticeView notice={null} status="voided" />);
    expect(screen.getByText(COPY['pay.void.badge'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: COPY['pay.edit'] })).toBeNull();
    expect(screen.queryByRole('button', { name: COPY['pay.void.cta'] })).toBeNull();
  });

  it('maps 409 payment_voided to no-edit copy and a Ver pago action', () => {
    const notice = mapPaymentWriteError(409, 'payment_voided');
    const onView = jest.fn();
    render(<PaymentWriteNoticeView notice={notice} onViewPayment={onView} />);
    expect(notice?.message).toBe('Este pago fue anulado y ya no se puede editar.');
    expect(notice?.message).toBe(COPY['pay.void.noEdit']);
    expect(screen.getByText(COPY['pay.void.noEdit'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: COPY['pay.edit'] })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Anular' })).toBeNull();
    expect(onView).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: COPY['pay.void.noEdit.cta'] }));
    expect(onView).toHaveBeenCalledTimes(1);
    expect(copyText('pay.void.noEdit', 'en')).toBe('This payment was voided and can no longer be edited.');
    expect(copyText('pay.void.noEdit.cta', 'en')).toBe('View payment');
  });

  it('maps 409 already_voided, refreshes, and shows the receipt as anulado', () => {
    const notice = mapPaymentWriteError(409, 'already_voided');
    const onView = jest.fn();
    render(<PaymentWriteNoticeView notice={notice} onViewPayment={onView} />);
    expect(notice?.message).toBe('Este pago ya estaba anulado.');
    expect(screen.getByText(COPY['pay.void.alreadyVoided'])).toBeTruthy();
    expect(screen.getByTestId('receipt-status').props.children).toBe('Anulado');
    expect(screen.queryByRole('button', { name: COPY['pay.edit'] })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Anular' })).toBeNull();
    expect(onView).toHaveBeenCalledTimes(1);
    expect(copyText('pay.void.alreadyVoided', 'en')).toBe('This payment was already voided.');
  });

  it('maps 409 conflict, 403 forbidden, and 404 not-found', () => {
    const conflict = mapPaymentWriteError(409, 'conflict');
    expect(conflict?.copyKey).toBe('pay.sync.conflict');
    expect(conflict?.message).toBe(COPY['pay.sync.conflict']);
    expect(conflict?.hideWrites).toBe(false);
    render(<PaymentWriteNoticeView notice={conflict} />);
    expect(screen.getByText(COPY['pay.sync.conflict'])).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY['pay.edit'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY['pay.void.cta'] })).toBeTruthy();
    expect(screen.queryByText(COPY['err.generic'])).toBeNull();

    const forbidden = mapPaymentWriteError(403, 'forbidden');
    expect(forbidden?.copyKey).toBe('err.forbidden');
    expect(forbidden?.hideWrites).toBe(true);
    expect(forbidden?.message).toBe(COPY['err.forbidden']);

    const missing = mapPaymentWriteError(404, 'not_found');
    expect(missing?.copyKey).toBe('err.notFound');
    expect(missing?.message).toBe(COPY['err.notFound']);
    expect(missing?.hideWrites).toBe(true);

    expect(copyText('pay.sync.conflict', 'en')).toContain('offline');
    expect(copyText('err.forbidden', 'en')).toContain('permission');
    expect(mapPaymentWriteError(403, 'forbidden', 'void')?.copyKey).toBe('pay.void.forbidden');
    expect(mapPaymentWriteError(403, 'forbidden', 'void')?.message).toBe(COPY['pay.void.forbidden']);
    expect(mapPaymentWriteError(404, 'not_found')?.cta).toBe(COPY['err.notFound.cta']);
  });
});
