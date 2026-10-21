import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  SCREEN_STATE_COPY,
  emptyAccessibilityLabel,
  errorAccessibilityLabel,
  loadingAccessibilityLabel,
  retryAccessibilityLabel,
} from '../copy/userFacing';

export type ScreenPhase = 'ready' | 'empty' | 'loading' | 'error';

export function ScreenState({
  phase,
  contextLabel,
  onRetry,
}: {
  phase: Exclude<ScreenPhase, 'ready'>;
  contextLabel: string;
  onRetry?: () => void;
}) {
  if (phase === 'loading') {
    return (
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={loadingAccessibilityLabel(contextLabel)}
        style={styles.block}
      >
        <ActivityIndicator color="#0F3D3E" />
        <Text style={styles.copy}>{SCREEN_STATE_COPY.loading}</Text>
      </View>
    );
  }

  if (phase === 'empty') {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel={emptyAccessibilityLabel(contextLabel)}
        style={styles.block}
      >
        <Text style={styles.copy}>{SCREEN_STATE_COPY.empty}</Text>
      </View>
    );
  }

  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={errorAccessibilityLabel(contextLabel)}
      style={styles.block}
    >
      <Text style={styles.copy}>{SCREEN_STATE_COPY.error}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={retryAccessibilityLabel(contextLabel)}
        onPress={onRetry}
        style={styles.retry}
      >
        <Text style={styles.retryLabel}>{SCREEN_STATE_COPY.retry}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: 12,
  },
  copy: {
    color: '#3D4F49',
    fontSize: 16,
    lineHeight: 24,
  },
  retry: {
    alignSelf: 'flex-start',
    backgroundColor: '#0F3D3E',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
