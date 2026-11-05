import { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import { COPY } from '../copy/userFacing';
import type { PaymentWriteNotice as Notice } from './paymentWriteError';

/**
 * Editar and Anular stay hidden for payment_voided and already_voided.
 * Ver pago reloads. already_voided refreshes on its own and shows Anulado.
 */
export function PaymentWriteNoticeView({
  notice,
  status = null,
  onViewPayment,
}: {
  notice: Notice | null;
  status?: 'recorded' | 'voided' | null;
  onViewPayment?: () => void;
}) {
  const refreshOnMount = notice?.refreshOnMount === true;
  const onView = useRef(onViewPayment);
  onView.current = onViewPayment;
  useEffect(() => {
    if (refreshOnMount) {
      onView.current?.();
    }
  }, [refreshOnMount]);

  const voided = status === 'voided';
  const hide = voided || notice?.hideWrites === true;
  const badge = notice?.voidedLabel ?? (voided ? COPY['pay.void.badge'] : null);
  return (
    <View>
      {notice ? (
        <Text accessibilityRole={notice.copyKey === 'pay.sync.conflict' ? 'text' : 'alert'}>{notice.message}</Text>
      ) : null}
      {badge ? <Text testID="receipt-status">{badge}</Text> : null}
      {notice?.cta ? (
        <Pressable accessibilityRole="button" accessibilityLabel={notice.cta} onPress={onViewPayment}>
          <Text>{notice.cta}</Text>
        </Pressable>
      ) : null}
      {hide ? null : (
        <View>
          <Pressable accessibilityRole="button" accessibilityLabel={COPY['pay.edit']}>
            <Text>{COPY['pay.edit']}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={COPY['pay.void.cta']}>
            <Text>{COPY['pay.void.cta']}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
