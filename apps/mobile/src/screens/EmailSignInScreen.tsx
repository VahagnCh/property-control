import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiClientError, ConnectingFailedError } from '../api/errors';
import { createAppApiClient } from '../api/createAppClient';
import { isPlausibleAuthEmail, normalizeAuthEmail } from '../auth/emailAddress';
import { codeExpiryLabel, remainingSeconds } from '../auth/codeExpiry';
import { COPY, fillCopy, type CopyKey } from '../copy/userFacing';
import { BRAND_TEAL } from '../theme/brand';

const SLOW_AFTER_MS = 8_000;

type SignInClient = {
  requestCode(
    email: string,
    mode?: 'send' | 'retry' | 'resend',
  ): Promise<{ accepted: true; resendAfterSeconds: number }>;
  verifyCode(email: string, code: string): Promise<{ expiresIn: number }>;
};

type Step = 'email' | 'code';

/**
 * Email-code sign-in. A 202 moves to the code step with the same copy whether
 * or not an account exists. Web cannot store a session, so the form stays off.
 */
export function EmailSignInScreen({
  client,
  expired = false,
  platformOS = Platform.OS,
  now = Date.now,
  embedded = false,
  onSignedIn,
}: {
  client?: SignInClient;
  expired?: boolean;
  platformOS?: string;
  now?: () => number;
  embedded?: boolean;
  onSignedIn?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const supported = platformOS !== 'web';
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [busySince, setBusySince] = useState<number | null>(null);
  const [errorKey, setErrorKey] = useState<CopyKey | null>(null);
  const [resendDeadline, setResendDeadline] = useState<number | null>(null);
  const [blockDeadline, setBlockDeadline] = useState<number | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [showLatest, setShowLatest] = useState(false);
  const [failedEmail, setFailedEmail] = useState<string | null>(null);
  const [failedAction, setFailedAction] = useState<'verify' | 'resend' | null>(null);
  const busyRef = useRef(false);
  const lastAuto = useRef('');
  const owned = useRef<SignInClient | null>(client ?? null);
  const clock = useClock(now, busySince !== null || resendDeadline !== null || blockDeadline !== null);
  const resendLeft = resendDeadline === null ? 0 : remainingSeconds(resendDeadline, clock);
  const blockLeft = blockDeadline === null ? 0 : remainingSeconds(blockDeadline, clock);
  const shownWait = Math.max(resendLeft, blockLeft);
  const slow = busySince !== null && clock - busySince >= SLOW_AFTER_MS;

  function currentClient(): SignInClient {
    if (client) {
      return client;
    }
    owned.current ??= createAppApiClient();
    return owned.current;
  }

  function begin() {
    busyRef.current = true;
    setBusy(true);
    setBusySince(now());
    setErrorKey(null);
  }

  function finishBusy() {
    busyRef.current = false;
    setBusy(false);
    setBusySince(null);
  }

  function applyFailure(error: unknown, normalized: string | null) {
    const banner = bannerFrom(error);
    setErrorKey(banner.key);
    if (banner.connection) {
      setFailedEmail(normalized);
      setFailedAction(step === 'code' && normalized === null ? 'verify' : 'resend');
    } else {
      setFailedAction(null);
    }
    if (banner.retryAfterSeconds !== null && banner.retryAfterSeconds > 0) {
      setBlockDeadline(now() + banner.retryAfterSeconds * 1000);
    }
  }

  async function submitEmail(mode: 'send' | 'retry' | 'resend') {
    const blocked = mode === 'resend' ? shownWait > 0 : blockLeft > 0;
    if (!supported || busyRef.current || blocked) {
      return;
    }
    if (!isPlausibleAuthEmail(email)) {
      setErrorKey('auth.email.invalid');
      setFailedEmail(null);
      return;
    }
    const normalized = normalizeAuthEmail(email);
    begin();
    try {
      const result = await currentClient().requestCode(normalized, mode);
      const sent = now();
      setSentAt(sent);
      setStep('code');
      setCode('');
      lastAuto.current = '';
      setFailedEmail(null);
      setFailedAction(null);
      setErrorKey(null);
      setShowLatest(mode === 'resend');
      setBlockDeadline(null);
      setResendDeadline(sent + result.resendAfterSeconds * 1000);
    } catch (error) {
      applyFailure(error, normalized);
    } finally {
      finishBusy();
    }
  }

  async function submitCode(digits: string) {
    if (!supported || busyRef.current || blockLeft > 0 || digits.length !== 6) {
      return;
    }
    begin();
    try {
      await currentClient().verifyCode(normalizeAuthEmail(email), digits);
      onSignedIn?.();
    } catch (error) {
      applyFailure(error, null);
    } finally {
      finishBusy();
    }
  }

  function onCodeChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (errorKey === 'auth.code.wrong') {
      setErrorKey(null);
    }
    if (digits.length < 6) {
      lastAuto.current = '';
      return;
    }
    if (lastAuto.current === digits || busyRef.current || blockLeft > 0) {
      return;
    }
    lastAuto.current = digits;
    void submitCode(digits);
  }

  function changeEmail() {
    setStep('email');
    setCode('');
    lastAuto.current = '';
    setShowLatest(false);
    setErrorKey(null);
    setFailedAction(null);
    setFailedEmail(null);
    setResendDeadline(null);
    setBlockDeadline(null);
    setSentAt(null);
  }

  const connectionRetry =
    errorKey === 'common.connecting.failed' && failedEmail !== null && normalizeAuthEmail(email) === failedEmail;
  const emailLabel = busy ? COPY['common.connecting'] : connectionRetry ? COPY['common.retry'] : COPY['auth.email.cta'];

  const body = (
    <View style={[styles.content, embedded ? null : { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}>
      {expired ? (
        <Text accessibilityRole="alert" style={styles.alert}>
          {COPY['auth.session.expired']}
        </Text>
      ) : null}
      <Text accessibilityRole="header" style={styles.title}>
        {step === 'email' ? COPY['auth.email.title'] : COPY['auth.code.title']}
      </Text>
      {!supported ? (
        <Text style={styles.body}>{COPY['auth.email.webUnavailable']}</Text>
      ) : step === 'email' ? (
        <>
          <Text style={styles.body}>{COPY['auth.email.body']}</Text>
          <Text style={styles.label}>{COPY['auth.email.label']}</Text>
          <TextInput
            testID="auth-email-input"
            accessibilityLabel={COPY['auth.email.label']}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!busy}
            inputMode="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              if (failedEmail && normalizeAuthEmail(value) !== failedEmail) {
                setFailedEmail(null);
                if (errorKey === 'common.connecting.failed') {
                  setErrorKey(null);
                }
              }
            }}
            style={styles.input}
          />
          {errorKey ? (
            <Text accessibilityRole="alert" testID="auth-error" style={styles.alert}>
              {COPY[errorKey]}
            </Text>
          ) : null}
          {shownWait > 0 ? (
            <Text style={styles.body}>{fillCopy(COPY['auth.code.resendWait'], { s: String(shownWait) })}</Text>
          ) : null}
          {slow ? <Text style={styles.body}>{COPY['common.connecting.slow']}</Text> : null}
          {busy ? <ActivityIndicator color={BRAND_TEAL} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={emailLabel}
            accessibilityState={{ disabled: busy || blockLeft > 0 }}
            disabled={busy || blockLeft > 0}
            onPress={() => {
              void submitEmail(connectionRetry ? 'retry' : 'send');
            }}
            style={styles.button}
          >
            <Text style={styles.buttonLabel}>{emailLabel}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.body}>{fillCopy(COPY['auth.code.body'], { email: normalizeAuthEmail(email) })}</Text>
          {sentAt !== null ? <Text style={styles.body}>{codeExpiryLabel(sentAt)}</Text> : null}
          {showLatest ? <Text style={styles.body}>{COPY['auth.code.latest']}</Text> : null}
          <Text style={styles.body}>{COPY['auth.code.spamHint']}</Text>
          <TextInput
            testID="auth-code-input"
            accessibilityLabel={COPY['auth.code.title']}
            autoComplete="one-time-code"
            editable={!busy}
            inputMode="numeric"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            value={code}
            onChangeText={onCodeChange}
            style={styles.input}
          />
          {errorKey ? (
            <Text accessibilityRole="alert" testID="auth-error" style={styles.alert}>
              {COPY[errorKey]}
            </Text>
          ) : null}
          {shownWait > 0 ? (
            <Text style={styles.body}>{fillCopy(COPY['auth.code.resendWait'], { s: String(shownWait) })}</Text>
          ) : null}
          {slow ? <Text style={styles.body}>{COPY['common.connecting.slow']}</Text> : null}
          {busy ? <ActivityIndicator color={BRAND_TEAL} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? COPY['common.connecting'] : COPY['auth.code.cta']}
            accessibilityState={{ disabled: busy || blockLeft > 0 || code.length !== 6 }}
            disabled={busy || blockLeft > 0 || code.length !== 6}
            onPress={() => {
              void submitCode(code);
            }}
            style={styles.button}
          >
            <Text style={styles.buttonLabel}>{busy ? COPY['common.connecting'] : COPY['auth.code.cta']}</Text>
          </Pressable>
          {errorKey === 'common.connecting.failed' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={COPY['common.retry']}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => {
                if (failedAction === 'verify') {
                  void submitCode(code);
                  return;
                }
                void submitEmail('retry');
              }}
              style={styles.secondary}
            >
              <Text style={styles.secondaryLabel}>{COPY['common.retry']}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              shownWait > 0 ? fillCopy(COPY['auth.code.resendWait'], { s: String(shownWait) }) : COPY['auth.code.resend']
            }
            accessibilityState={{ disabled: busy || shownWait > 0 }}
            disabled={busy || shownWait > 0}
            onPress={() => {
              void submitEmail('resend');
            }}
            style={styles.secondary}
          >
            <Text style={styles.secondaryLabel}>
              {shownWait > 0 ? fillCopy(COPY['auth.code.resendWait'], { s: String(shownWait) }) : COPY['auth.code.resend']}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={COPY['auth.code.changeEmail']}
            onPress={changeEmail}
            style={styles.secondary}
          >
            <Text style={styles.secondaryLabel}>{COPY['auth.code.changeEmail']}</Text>
          </Pressable>
        </>
      )}
    </View>
  );

  if (embedded) {
    return (
      <View testID="auth-sign-in" style={styles.embedded}>
        {body}
      </View>
    );
  }

  return (
    <ScrollView
      testID="auth-sign-in"
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      {body}
    </ScrollView>
  );
}

function useClock(now: () => number, running: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const id = setInterval(() => setTick((value) => value + 1), 1000);
    const subscription =
      typeof AppState.addEventListener === 'function'
        ? AppState.addEventListener('change', (state) => {
            if (state === 'active') {
              setTick((value) => value + 1);
            }
          })
        : null;
    return () => {
      clearInterval(id);
      subscription?.remove();
    };
  }, [running]);
  void tick;
  return now();
}

function bannerFrom(error: unknown): { key: CopyKey; retryAfterSeconds: number | null; connection: boolean } {
  if (error instanceof ConnectingFailedError) {
    return { key: 'common.connecting.failed', retryAfterSeconds: null, connection: true };
  }
  if (error instanceof ApiClientError) {
    const connection =
      error.copyKey === 'common.connecting.failed' ||
      error.code === 'auth.unavailable' ||
      error.code === 'network' ||
      error.code === 'timeout';
    return { key: error.copyKey, retryAfterSeconds: error.retryAfterSeconds, connection };
  }
  return { key: 'common.error', retryAfterSeconds: null, connection: false };
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    backgroundColor: '#F4F7F6',
  },
  embedded: {
    backgroundColor: '#F4F7F6',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    gap: 12,
  },
  title: {
    color: '#14221E',
    fontSize: 28,
    fontWeight: '700',
  },
  label: {
    color: '#14221E',
    fontSize: 16,
    fontWeight: '600',
  },
  body: {
    color: '#3D4F49',
    fontSize: 16,
    lineHeight: 24,
  },
  alert: {
    color: '#8C3A32',
    fontSize: 16,
    lineHeight: 24,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#C5D1CC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 18,
    color: '#14221E',
    backgroundColor: '#FFFFFF',
  },
  button: {
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
  secondary: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 12,
  },
  secondaryLabel: {
    color: BRAND_TEAL,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
