import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApiClient } from '../api/client';
import { copyText } from '../copy/userFacing';
import { BRAND_TEAL } from '../theme/brand';
import { HealthWatch, realHealthClock, type HealthWatchSnapshot } from './healthWatch';

const HIDDEN: HealthWatchSnapshot = { phase: 'idle', copyKey: null, slow: false, retryLabel: null };

export function HealthBanner({
  snapshot,
  onRetry,
}: {
  snapshot: HealthWatchSnapshot;
  onRetry?: () => void;
}) {
  if (!snapshot.copyKey && !snapshot.slow) {
    return null;
  }
  return (
    <View testID="health-banner" style={styles.banner}>
      {snapshot.copyKey ? <Text accessibilityRole="text">{copyText(snapshot.copyKey)}</Text> : null}
      {snapshot.slow ? <Text accessibilityRole="text">{copyText('common.connecting.slow')}</Text> : null}
      {snapshot.retryLabel ? (
        <Pressable accessibilityRole="button" accessibilityLabel={snapshot.retryLabel} onPress={onRetry}>
          <Text style={styles.retry}>{snapshot.retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Starts the launch check and listens for a long background. The watch is
 * injected in tests so they can drive the clock without a 90s wait.
 */
export function LaunchHealth({ client, watch }: { client?: ApiClient; watch?: HealthWatch }) {
  const [snapshot, setSnapshot] = useState<HealthWatchSnapshot>(HIDDEN);
  const [current, setCurrent] = useState<HealthWatch | null>(watch ?? null);

  useEffect(() => {
    const owned =
      watch ??
      (client
        ? new HealthWatch(() => client.checkHealth(), realHealthClock)
        : null);
    if (!owned) {
      return undefined;
    }
    setCurrent(owned);
    setSnapshot(owned.current());
    const unsubscribe = owned.subscribe(setSnapshot);
    owned.start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' || state === 'background' || state === 'inactive') {
        owned.noteAppState(state);
      }
    });
    return () => {
      unsubscribe();
      owned.stop();
      subscription.remove();
    };
  }, [client, watch]);

  return <HealthBanner snapshot={snapshot} onRetry={() => current?.start()} />;
}

const styles = StyleSheet.create({
  banner: {
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#E7F0EE',
  },
  retry: {
    color: BRAND_TEAL,
    fontSize: 16,
    fontWeight: '600',
  },
});
