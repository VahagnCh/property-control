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
  onViewPayment,
}: {
  notice: Notice | null;
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

  const hide = notice?.hideWrites === true;
  return (
    <View>
      {notice ? (
        <Text accessibilityRole={notice.copyKey === 'common.conflict' ? 'text' : 'alert'}>{notice.message}</Text>
      ) : null}
      {notice?.voidedLabel ? <Text testID="receipt-status">{notice.voidedLabel}</Text> : null}
      {notice?.cta ? (
        <Pressable accessibilityRole="button" accessibilityLabel={notice.cta} onPress={onViewPayment}>
          <Text>{notice.cta}</Text>
        </Pressable>
      ) : null}
      {hide ? null : (
        <View>
          <Pressable accessibilityRole="button" accessibilityLabel={COPY['pay.action.edit']}>
            <Text>{COPY['pay.action.edit']}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Anular">
            <Text>Anular</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
