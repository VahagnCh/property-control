import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COPY } from '../copy/userFacing';
import { BRAND_TEAL } from '../theme/brand';
import { hydrateSession } from './loadSession';

const SLOW_AFTER_MS = 8_000;

/**
 * Shown when SecureStore cannot be read. This is not the sign-in screen.
 * Retry reads the store again. It does not clear it.
 */
export function SessionUnavailable() {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!busy) {
      return undefined;
    }
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 1000);
    return () => clearInterval(id);
  }, [busy]);

  async function retry() {
    if (busy) {
      return;
    }
    setBusy(true);
    setElapsed(0);
    try {
      await hydrateSession();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      testID="session-unavailable"
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}
    >
      <Text style={styles.title} accessibilityRole="header">
        {busy ? COPY['common.connecting'] : COPY['common.connecting.failed']}
      </Text>
      {busy && elapsed >= SLOW_AFTER_MS ? <Text style={styles.body}>{COPY['common.connecting.slow']}</Text> : null}
      {busy ? <ActivityIndicator color={BRAND_TEAL} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={COPY['common.retry']}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => {
          void retry();
        }}
        style={styles.button}
      >
        <Text style={styles.buttonLabel}>{COPY['common.retry']}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    gap: 16,
    backgroundColor: '#F4F7F6',
  },
  title: {
    color: '#14221E',
    fontSize: 28,
    fontWeight: '700',
  },
  body: {
    color: '#3D4F49',
    fontSize: 16,
    lineHeight: 24,
  },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: BRAND_TEAL,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
