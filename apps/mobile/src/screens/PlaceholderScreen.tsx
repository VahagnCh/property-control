import { StyleSheet, Text, View } from 'react-native';
import { ScreenState, type ScreenPhase } from '../components/ScreenState';
import { PRODUCT_NAME } from '../copy/userFacing';

export function PlaceholderScreen({
  title,
  body,
  phase = 'ready',
  onRetry,
}: {
  title: string;
  body: string;
  phase?: ScreenPhase;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.screen}>
      <Text style={styles.kicker}>{PRODUCT_NAME}</Text>
      <Text style={styles.title}>{title}</Text>
      {phase === 'ready' ? (
        <Text style={styles.body}>{body}</Text>
      ) : (
        <ScreenState phase={phase} contextLabel={title} onRetry={onRetry} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F4F7F6',
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  kicker: {
    color: '#0F6E56',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  title: {
    color: '#14221E',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 12,
  },
  body: {
    color: '#3D4F49',
    fontSize: 16,
    lineHeight: 24,
  },
});
