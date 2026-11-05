import { fireEvent, render, screen } from '@testing-library/react-native';
import { COPY, copyText } from '../copy/userFacing';
import { PaymentWriteNoticeView } from './PaymentWriteNotice';
import { mapPaymentWriteError } from './paymentWriteError';

describe('payment write errors', () => {
  it('maps 409 payment_voided to no-edit copy and a Ver pago action', () => {
    const notice = mapPaymentWriteError(409, 'payment_voided');
    const onView = jest.fn();
    render(<PaymentWriteNoticeView notice={notice} onViewPayment={onView} />);
    expect(notice?.message).toBe('Este pago fue anulado y ya no se puede editar.');
    expect(notice?.message).toBe(COPY['pay.void.noEdit']);
    expect(screen.getByText(COPY['pay.void.noEdit'])).toBeTruthy();
    expect(screen.queryByRole('button', { name: COPY['pay.action.edit'] })).toBeNull();
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
    expect(screen.queryByRole('button', { name: COPY['pay.action.edit'] })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Anular' })).toBeNull();
    expect(onView).toHaveBeenCalledTimes(1);
    expect(copyText('pay.void.alreadyVoided', 'en')).toBe('This payment was already voided.');
  });

  it('maps 409 conflict, 403 forbidden, and 404 not-found', () => {
    const conflict = mapPaymentWriteError(409, 'conflict');
    expect(conflict?.copyKey).toBe('common.conflict');
    expect(conflict?.message).toBe(COPY['common.conflict']);
    expect(conflict?.hideWrites).toBe(false);
    render(<PaymentWriteNoticeView notice={conflict} />);
    expect(screen.getByText(COPY['common.conflict'])).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY['pay.action.edit'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Anular' })).toBeTruthy();
    expect(screen.queryByText(COPY['common.error'])).toBeNull();

    const forbidden = mapPaymentWriteError(403, 'forbidden');
    expect(forbidden?.copyKey).toBe('access.readonly');
    expect(forbidden?.hideWrites).toBe(true);
    expect(forbidden?.message).toBe(COPY['access.readonly']);

    const missing = mapPaymentWriteError(404, 'not_found');
    expect(missing?.copyKey).toBe('common.notFound');
    expect(missing?.message).toBe(COPY['common.notFound']);
    expect(missing?.hideWrites).toBe(true);

    expect(copyText('common.conflict', 'en')).toContain('already exists');
    expect(copyText('access.readonly', 'en')).toContain('view this information');
  });
});
