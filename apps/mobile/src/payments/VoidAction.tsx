import { Pressable, Text } from 'react-native';
import {
  mapVoidResponse,
  PaymentSnapshot,
  showAnular,
  MembershipRole,
} from './voidPayment';

export function VoidAction({
  role,
  onPress,
}: {
  role: MembershipRole | null;
  onPress?: () => void;
}) {
  if (!showAnular(role)) {
    return null;
  }
  return (
    <Pressable
      testID={`anular-${role ?? 'none'}`}
      accessibilityRole="button"
      accessibilityLabel="Anular"
      onPress={onPress}
    >
      <Text>Anular</Text>
    </Pressable>
  );
}

export function VoidErrorText({
  status,
  payment,
}: {
  status: number;
  payment: PaymentSnapshot;
}) {
  const result = mapVoidResponse(payment, status);
  if (!result.message) {
    return null;
  }
  return <Text testID={result.refresh ? 'void-needs-refresh' : undefined}>{result.message}</Text>;
}
