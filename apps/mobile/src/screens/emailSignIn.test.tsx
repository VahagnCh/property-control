import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Dimensions, PixelRatio } from 'react-native';
import { ReactNode } from 'react';
import { COPY, fillCopy } from '../copy/userFacing';
import { createApiClient } from '../api/client';
import { AUTH_CODE_ACCEPTED_MESSAGE, AUTH_CODE_PATH, AUTH_VERIFY_PATH, REFRESH_PATH } from '../api/contract';
import { createContractFakeServer } from '../api/testing/fakeServer';
import type { TokenStore } from '../auth/tokenStore';
import { normalizeAuthEmail } from '../auth/emailAddress';
import { resetSessionState, setSessionExpired } from '../session/readSession';
import { renderWithSafeArea } from '../test/renderTabs';
import App from '../../App';
import { EmailSignInScreen } from './EmailSignInScreen';

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `exp://127.0.0.1:8081/--${path.startsWith('/') ? path : `/${path}`}`,
  getInitialURL: jest.fn(async () => null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    SafeAreaProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(actual.SafeAreaProvider, {
        initialMetrics: {
          frame: { x: 0, y: 0, width: 320, height: 568 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        },
        children,
      }),
  };
});

const EMAIL = 'josé.müñoz.áéíóúñü@ejemplo.com';

function memoryStore(): TokenStore & { current: () => { accessToken: string; refreshToken: string } | null } {
  let current: { accessToken: string; refreshToken: string } | null = {
    accessToken: 'stale-access',
    refreshToken: 'stale-refresh',
  };
  return {
    current: () => current,
    async read() {
      return current;
    },
    async save(tokens) {
      current = tokens;
    },
    async clear() {
      current = null;
    },
  };
}

function clientFor(server: ReturnType<typeof createContractFakeServer>, randomUUID?: () => string) {
  return createApiClient({
    baseUrl: 'http://127.0.0.1:4010',
    env: 'test',
    tokenStore: memoryStore(),
    fetchImpl: server.fetch,
    randomUUID,
  });
}

describe('email sign-in screen', () => {
  beforeEach(() => {
    resetSessionState();
  });

  it('shows the email step empty, then the code step only after 202', async () => {
    const server = createContractFakeServer();
    const sentAt = Date.parse('2026-10-31T05:55:00.000Z');
    renderWithSafeArea(
      <EmailSignInScreen client={clientFor(server)} now={() => sentAt} />,
    );
    expect(screen.getByText(COPY['auth.email.title'])).toBeTruthy();
    expect(screen.getByText(COPY['auth.email.body'])).toBeTruthy();
    expect(screen.getByLabelText(COPY['auth.email.label']).props.value).toBe('');
    expect(screen.queryByText(COPY['auth.code.title'])).toBeNull();
    expect(screen.queryByText('Entrar')).toBeNull();
    expect(screen.queryByTestId('auth-error')).toBeNull();

    fireEvent.changeText(screen.getByLabelText(COPY['auth.email.label']), `  ${EMAIL}  `);
    fireEvent.press(screen.getByRole('button', { name: COPY['auth.email.cta'] }));

    expect(await screen.findByText(COPY['auth.code.title'])).toBeTruthy();
    const body = fillCopy(COPY['auth.code.body'], { email: normalizeAuthEmail(`  ${EMAIL}  `) });
    expect(screen.getByText(body)).toBeTruthy();
    expect(body).toContain('á');
    expect(body).toContain('é');
    expect(body).toContain('í');
    expect(body).toContain('ó');
    expect(body).toContain('ú');
    expect(body).toContain('ñ');
    expect(body).toContain('ü');
    expect(screen.getByText(COPY['auth.code.spamHint'])).toBeTruthy();
    expect(screen.queryByText(COPY['auth.code.latest'])).toBeNull();
    expect(screen.queryByText(AUTH_CODE_ACCEPTED_MESSAGE)).toBeNull();
    expect(screen.getByText('El código vence a las 12:05 a. m.')).toBeTruthy();
    expect(screen.queryByText(/2026-10-31/)).toBeNull();
    expect(screen.queryByText(/2026-10-30/)).toBeNull();
    const input = screen.getByTestId('auth-code-input');
    expect(input.props.textContentType).toBe('oneTimeCode');
    expect(input.props.autoComplete).toBe('one-time-code');
    expect(input.props.keyboardType).toBe('number-pad');
  });

  it('maps an invalid email and a 429 wait from Retry-After', async () => {
    const server = createContractFakeServer();
    let posts = 0;
    const keys: string[] = [];
    server.route('POST', AUTH_CODE_PATH, (request) => {
      posts += 1;
      keys.push(request.headers['idempotency-key'] ?? '');
      if (posts === 1) {
        return {
          status: 400,
          body: { statusCode: 400, error: 'auth.email_invalid', message: `bad ${EMAIL}` },
        };
      }
      return {
        status: 429,
        headers: { 'retry-after': '75' },
        body: { statusCode: 429, error: 'auth.rate_limited', message: 'Too many.' },
      };
    });
    const client = clientFor(server);
    renderWithSafeArea(<EmailSignInScreen client={client} now={() => 1_700_000_000_000} />);

    fireEvent.press(screen.getByRole('button', { name: COPY['auth.email.cta'] }));
    expect(screen.getByText(COPY['auth.email.invalid'])).toBeTruthy();
    expect(posts).toBe(0);

    fireEvent.changeText(screen.getByLabelText(COPY['auth.email.label']), EMAIL);
    fireEvent.press(screen.getByRole('button', { name: COPY['auth.email.cta'] }));
    expect(await screen.findByText(COPY['auth.email.invalid'])).toBeTruthy();
    expect(screen.queryByText(COPY['auth.code.title'])).toBeNull();
    expect(screen.getByTestId('auth-error').props.children).toBe(COPY['auth.email.invalid']);

    fireEvent.press(screen.getByRole('button', { name: COPY['auth.email.cta'] }));
    expect(await screen.findByText(COPY['auth.code.wait'])).toBeTruthy();
    expect(screen.getByText(fillCopy(COPY['auth.code.resendWait'], { s: '75' }))).toBeTruthy();
    expect(screen.getByTestId('auth-error').props.children).not.toContain(EMAIL);
  });

  it('reuses the key on Reintentar, mints one for another email, and shows latest only after Reenviar', async () => {
    let n = 0;
    const ids = [1, 2, 3, 4].map(
      (item) => `00000000-0000-4000-8000-${item.toString(16).padStart(12, '0')}`,
    );
    const server = createContractFakeServer();
    const keys: string[] = [];
    server.route('POST', AUTH_CODE_PATH, (request) => {
      keys.push(request.headers['idempotency-key'] ?? '');
      if (keys.length === 1) {
        return { status: 202, networkError: true };
      }
      return { status: 202, body: { message: AUTH_CODE_ACCEPTED_MESSAGE } };
    });
    let clock = Date.parse('2026-10-31T06:00:00.000Z');
    const handlers: Array<(state: string) => void> = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      handlers.push(handler as (state: string) => void);
      return { remove: jest.fn() };
    });
    try {
    renderWithSafeArea(
      <EmailSignInScreen client={clientFor(server, () => ids[n++] ?? ids[0])} now={() => clock} />,
    );
    fireEvent.changeText(screen.getByLabelText(COPY['auth.email.label']), 'persona@ejemplo.com');
    fireEvent.press(screen.getByRole('button', { name: COPY['auth.email.cta'] }));
    expect(await screen.findByText(COPY['common.connecting.failed'])).toBeTruthy();
    expect(server.calls('POST', AUTH_CODE_PATH)).toHaveLength(1);
    fireEvent.press(screen.getByRole('button', { name: COPY['common.retry'] }));
    expect(await screen.findByText(COPY['auth.code.title'])).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
    expect(screen.queryByText(COPY['auth.code.latest'])).toBeNull();
    expect(screen.getAllByText(fillCopy(COPY['auth.code.resendWait'], { s: '60' })).length).toBeGreaterThan(0);

    clock += 25_000;
    await act(async () => {
      handlers.forEach((handler) => handler('active'));
    });
    expect(screen.getAllByText(fillCopy(COPY['auth.code.resendWait'], { s: '35' })).length).toBeGreaterThan(0);

    clock += 35_000;
    await act(async () => {
      handlers.forEach((handler) => handler('active'));
    });
    fireEvent.press(screen.getByRole('button', { name: COPY['auth.code.resend'] }));
    expect(await screen.findByText(COPY['auth.code.latest'])).toBeTruthy();
    expect(keys[2]).not.toBe(keys[1]);

    fireEvent.press(screen.getByRole('button', { name: COPY['auth.code.changeEmail'] }));
    expect(screen.queryByText(COPY['auth.code.latest'])).toBeNull();
    fireEvent.changeText(screen.getByLabelText(COPY['auth.email.label']), 'otra@ejemplo.com');
    fireEvent.press(screen.getByRole('button', { name: COPY['auth.email.cta'] }));
    expect(await screen.findByText(COPY['auth.code.title'])).toBeTruthy();
    expect(keys[3]).not.toBe(keys[2]);
    expect(screen.queryByText(COPY['auth.code.latest'])).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('accepts a pasted code, rejects a wrong one without refresh, then accepts the next', async () => {
    const server = createContractFakeServer();
    const tokens = memoryStore();
    const client = createApiClient({
      baseUrl: 'http://127.0.0.1:4010',
      env: 'test',
      tokenStore: tokens,
      fetchImpl: server.fetch,
    });
    let verifies = 0;
    server.route('POST', AUTH_VERIFY_PATH, () => {
      verifies += 1;
      if (verifies === 1) {
        return {
          status: 401,
          body: { statusCode: 401, error: 'auth.code_invalid', message: `wrong ${EMAIL} 123456` },
        };
      }
      return {
        status: 200,
        body: {
          tokenType: 'Bearer',
          accessToken: 'access-ok',
          expiresIn: 900,
          refreshToken: 'rt_ok',
        },
      };
    });
    const onSignedIn = jest.fn();
    renderWithSafeArea(<EmailSignInScreen client={client} onSignedIn={onSignedIn} />);
    fireEvent.changeText(screen.getByLabelText(COPY['auth.email.label']), 'persona@ejemplo.com');
    fireEvent.press(screen.getByRole('button', { name: COPY['auth.email.cta'] }));
    expect(await screen.findByTestId('auth-code-input')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('auth-code-input'), '12 34 56');
    expect(await screen.findByText(COPY['auth.code.wrong'])).toBeTruthy();
    expect(screen.getByTestId('auth-error').props.children).toBe(COPY['auth.code.wrong']);
    expect(screen.getByTestId('auth-error').props.children).not.toContain('123456');
    expect(screen.getByTestId('auth-error').props.children).not.toContain(EMAIL);
    expect(server.calls('POST', REFRESH_PATH)).toHaveLength(0);
    expect(verifies).toBe(1);
    expect(tokens.current()).toEqual({ accessToken: 'stale-access', refreshToken: 'stale-refresh' });

    fireEvent.changeText(screen.getByTestId('auth-code-input'), '654321');
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledTimes(1);
    });
    expect(verifies).toBe(2);
    expect(tokens.current()).toEqual({ accessToken: 'access-ok', refreshToken: 'rt_ok' });
    expect(server.calls('POST', REFRESH_PATH)).toHaveLength(0);
  });

  it('shows the slow connection copy while a code request is still pending', async () => {
    jest.useFakeTimers();
    try {
      let release: (value: { accepted: true; resendAfterSeconds: number }) => void = () => undefined;
      const pending = new Promise<{ accepted: true; resendAfterSeconds: number }>((resolve) => {
        release = resolve;
      });
      const requestCode = jest.fn(() => pending);
      renderWithSafeArea(
        <EmailSignInScreen
          client={{ requestCode, verifyCode: jest.fn() }}
          now={() => Date.now()}
        />,
      );
      fireEvent.changeText(screen.getByLabelText(COPY['auth.email.label']), 'persona@ejemplo.com');
      const send = screen.getByRole('button', { name: COPY['auth.email.cta'] });
      fireEvent.press(send);
      fireEvent.press(send);
      expect(requestCode).toHaveBeenCalledTimes(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(8_000);
      });
      expect(screen.getByText(COPY['common.connecting.slow'])).toBeTruthy();
      await act(async () => {
        release({ accepted: true, resendAfterSeconds: 60 });
      });
      expect(await screen.findByText(COPY['auth.code.title'])).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps long copy available on a small screen at font scale 2', () => {
    Dimensions.set({
      window: { width: 320, height: 568, scale: 2, fontScale: 2 },
      screen: { width: 320, height: 568, scale: 2, fontScale: 2 },
    });
    expect(PixelRatio.getFontScale()).toBeCloseTo(2, 1);
    const source = require('fs').readFileSync(require('path').join(__dirname, 'EmailSignInScreen.tsx'), 'utf8');
    expect(source).not.toContain('numberOfLines');
    expect(source).not.toContain('ellipsizeMode');
    renderWithSafeArea(<EmailSignInScreen platformOS="ios" client={{ requestCode: jest.fn(), verifyCode: jest.fn() }} />, {
      width: 320,
      height: 568,
    });
    expect(screen.getByText(COPY['auth.email.title'])).toBeTruthy();
    expect(screen.getByText(COPY['auth.email.body'])).toBeTruthy();
    expect(screen.getByText(COPY['auth.email.cta'])).toBeTruthy();
    expect(screen.getByTestId('auth-sign-in')).toBeTruthy();
  });

  it('disables real sign-in on web', () => {
    const requestCode = jest.fn();
    renderWithSafeArea(
      <EmailSignInScreen platformOS="web" client={{ requestCode, verifyCode: jest.fn() }} />,
    );
    expect(screen.getByText(COPY['auth.email.title'])).toBeTruthy();
    expect(screen.getByText(COPY['auth.email.webUnavailable'])).toBeTruthy();
    expect(screen.queryByLabelText(COPY['auth.email.label'])).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(requestCode).not.toHaveBeenCalled();
  });

  it('shows the expiry line at 23:59, hides it at 00:01, and waits for a 401 before an error', async () => {
    const server = createContractFakeServer();
    server.route('POST', AUTH_VERIFY_PATH, () => ({
      status: 401,
      body: { statusCode: 401, error: 'auth.code_invalid', message: 'The code is not valid.' },
    }));
    let clock = Date.parse('2026-10-31T05:50:00.000Z');
    const handlers: Array<(state: string) => void> = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      handlers.push(handler as (state: string) => void);
      return { remove: jest.fn() };
    });
    try {
      renderWithSafeArea(<EmailSignInScreen client={clientFor(server)} now={() => clock} />);
      fireEvent.changeText(screen.getByLabelText(COPY['auth.email.label']), 'persona@ejemplo.com');
      fireEvent.press(screen.getByRole('button', { name: COPY['auth.email.cta'] }));
      expect(await screen.findByText('El código vence a las 12:00 a. m.')).toBeTruthy();

      clock = Date.parse('2026-10-31T05:59:00.000Z');
      await act(async () => {
        handlers.forEach((handler) => handler('active'));
      });
      expect(screen.getByTestId('auth-code-expiry').props.children).toBe('El código vence a las 12:00 a. m.');
      expect(screen.queryByTestId('auth-error')).toBeNull();

      clock = Date.parse('2026-10-31T06:01:00.000Z');
      await act(async () => {
        handlers.forEach((handler) => handler('active'));
      });
      expect(screen.queryByTestId('auth-code-expiry')).toBeNull();
      expect(screen.queryByText(/vence a las/)).toBeNull();
      expect(screen.queryByTestId('auth-error')).toBeNull();
      const resend = screen.getByRole('button', { name: COPY['auth.code.resend'] });
      expect(resend.props.accessibilityState?.disabled).toBe(false);

      fireEvent.changeText(screen.getByTestId('auth-code-input'), '123456');
      expect(await screen.findByText(COPY['auth.code.wrong'])).toBeTruthy();
      expect(screen.queryByText('auth.code.expired')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('opens sign-in when the session expires', async () => {
    render(<App />);
    expect(await screen.findByTestId('tab-Inicio')).toBeTruthy();
    act(() => {
      setSessionExpired();
    });
    expect(await screen.findByText(COPY['auth.session.expired'])).toBeTruthy();
    expect(screen.getByText(COPY['auth.email.title'])).toBeTruthy();
    expect(screen.queryByText(COPY['common.connecting.failed'])).toBeNull();
  });
});
