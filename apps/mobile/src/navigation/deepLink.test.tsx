import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ExpoLinking from 'expo-linking';
import fs from 'fs';
import path from 'path';
import { ReactNode } from 'react';
import { COPY, TAB_BODIES } from '../copy/userFacing';
import * as session from '../session/readSession';
import App from '../../App';
import {
  handledDeepLinkUrl,
  notificationDeepLink,
  parseDeepLink,
  resolveDeepLink,
} from './deepLink';
import { allowsDevPrefix, currentDevPrefixEnv, type DevPrefixEnv } from './devPrefix';
import { dropHeld, settleHeld } from './heldLink';
import { createLinkingOptions, getStateFromPath } from './linking';

const EXPO_GO = 'exp://127.0.0.1:8081/--/';
const UUID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SECRET = 'sekret-access';
const REFRESH = 'sekret-refresh';
const POISONED = `duerecord://notificaciones/${UUID}?access_token=${SECRET}&refresh_token=${REFRESH}#otp=${SECRET}`;

jest.mock('expo-linking', () => ({
  createURL: (path: string) => {
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `exp://127.0.0.1:8081/--${suffix}`;
  },
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
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        },
        children,
      }),
  };
});

jest.mock('../session/readSession', () => {
  let hasSession = false;
  let reads = 0;
  return {
    readSession: () => {
      reads += 1;
      return hasSession;
    },
    __setHasSession: (value: boolean) => {
      hasSession = value;
    },
    __readCount: () => reads,
    __resetReads: () => {
      reads = 0;
    },
  };
});

function setHasSession(value: boolean) {
  (session as unknown as { __setHasSession: (next: boolean) => void }).__setHasSession(value);
}

function readCount(): number {
  return (session as unknown as { __readCount: () => number }).__readCount();
}

function resetReads() {
  (session as unknown as { __resetReads: () => void }).__resetReads();
}

function setInitialUrl(url: string | null) {
  (ExpoLinking.getInitialURL as jest.Mock).mockResolvedValue(url);
}

function emitUrl(url: string) {
  const calls = (ExpoLinking.addEventListener as jest.Mock).mock.calls;
  const handler = calls[calls.length - 1]?.[1] as ((event: { url: string }) => void) | undefined;
  if (!handler) {
    throw new Error('linking listener was not registered');
  }
  handler({ url });
}

function treeText(): string {
  return JSON.stringify(screen.toJSON());
}

const linkingConfig = {
  screens: {
    Inicio: '',
    Propiedades: 'propiedades',
    Pagos: 'pagos',
    Mantenimiento: 'mantenimiento',
    Documentos: 'documentos',
    Notificacion: 'notificaciones/:nid',
  },
};

const PRODUCTION: DevPrefixEnv = { dev: false, executionEnvironment: 'standalone' };
const DEV_BUILD: DevPrefixEnv = { dev: true, executionEnvironment: 'bare' };
const EXPO_GO_ENV: DevPrefixEnv = { dev: false, executionEnvironment: 'storeClient' };

function routeState(path: string, options: typeof linkingConfig | ReturnType<typeof createLinkingOptions>['config'] = linkingConfig) {
  return getStateFromPath(path, options);
}

function routeParams(path: string): Record<string, unknown> | undefined {
  const state = routeState(path);
  if (!state) {
    return undefined;
  }
  const index = state.index ?? state.routes.length - 1;
  return state.routes[index]?.params as Record<string, unknown> | undefined;
}

function routeName(
  path: string,
  options: typeof linkingConfig | ReturnType<typeof createLinkingOptions>['config'] = linkingConfig,
): string | undefined {
  const state = routeState(path, options);
  if (!state) {
    return undefined;
  }
  const index = state.index ?? state.routes.length - 1;
  return state.routes[index]?.name;
}

describe('duerecord deep links', () => {
  beforeEach(() => {
    setHasSession(false);
    setInitialUrl(null);
    resetReads();
  });

  it('keeps a store build on duerecord and adds the Expo Go prefix only for Expo Go or dev', () => {
    const production = createLinkingOptions({
      dev: false,
      executionEnvironment: 'standalone',
      expoGoPrefix: EXPO_GO,
    });
    expect(production.prefixes).toEqual(['duerecord://']);

    const dev = createLinkingOptions({
      dev: true,
      executionEnvironment: 'bare',
      expoGoPrefix: EXPO_GO,
    });
    expect(dev.prefixes).toEqual(['duerecord://', EXPO_GO]);

    const expoGo = createLinkingOptions({
      dev: false,
      executionEnvironment: 'storeClient',
      expoGoPrefix: EXPO_GO,
    });
    expect(expoGo.prefixes).toEqual(['duerecord://', EXPO_GO]);
    expect(production.prefixes).not.toEqual(expect.arrayContaining([expect.stringMatching(/^exps?:\/\//)]));
  });

  it('does not let the web linking map route an invalid nid', () => {
    const web = createLinkingOptions({
      dev: false,
      executionEnvironment: 'standalone',
      expoGoPrefix: EXPO_GO,
    });
    expect(web.prefixes).toEqual(['duerecord://']);
    expect(JSON.stringify(web.config?.screens)).not.toContain('notificaciones');
    expect(routeName('pagos?token=abc', web.config)).toBe('Pagos');
    expect(routeParams('pagos?token=abc')).toBeUndefined();

    const poisoned = [
      'notificaciones/Llama-al-5555',
      `notificaciones/${UUID}%3Ftoken%3Dabc`,
      `/notificaciones/${UUID}%3Ftoken%3Dabc`,
      `notificaciones/${UUID}%3Ftoken%3Dabc#otp`,
      `notificaciones/${UUID}/extra`,
    ];
    for (const path of poisoned) {
      expect(routeState(path, web.config)).toBeUndefined();
      expect(routeState(path, linkingConfig)).toBeUndefined();
    }
    expect(routeName(`notificaciones/${UUID}`, web.config)).toBeUndefined();
    expect(routeParams(`notificaciones/${UUID}?token=abc&code=1#access_token=${SECRET}`)).toEqual({
      nid: UUID,
    });
  });

  it('strips query and fragment before route params are built', () => {
    expect(routeParams('pagos?token=abc&code=1')).toBeUndefined();
    expect(routeParams('pagos?token=abc&code=1#access_token=abc')?.token).toBeUndefined();
    expect(routeParams('/?access_token=abc')).toBeUndefined();
    expect(routeParams('?access_token=abc')).toBeUndefined();

    const notification = routeParams(`notificaciones/${UUID}?token=abc&code=1#access_token=${SECRET}`);
    expect(notification).toEqual({ nid: UUID });
    expect(notification).not.toHaveProperty('token');
    expect(notification).not.toHaveProperty('code');
    expect(notification).not.toHaveProperty('access_token');
  });

  it('parses an Expo Go link the same way as duerecord when the dev prefix is allowed', () => {
    expect(parseDeepLink(`${EXPO_GO}notificaciones/${UUID}?access_token=${SECRET}`, DEV_BUILD)).toEqual(
      parseDeepLink(`duerecord://notificaciones/${UUID}`, DEV_BUILD),
    );
    expect(parseDeepLink(`${EXPO_GO}pagos?token=abc`, EXPO_GO_ENV)).toEqual(
      parseDeepLink('duerecord://pagos?token=abc', EXPO_GO_ENV),
    );
    expect(parseDeepLink(`${EXPO_GO}notificaciones/${UUID}`, EXPO_GO_ENV)).toEqual({
      status: 'notification',
      nid: UUID,
    });
  });

  it('parses exp:// and exps:// only in Expo Go or a dev build', () => {
    const production = { dev: false, executionEnvironment: 'standalone' };
    expect(parseDeepLink(`${EXPO_GO}notificaciones/${UUID}?access_token=${SECRET}`, production)).toEqual({
      status: 'unhandled',
    });
    expect(parseDeepLink(`exps://evil.example/--/notificaciones/${UUID}`, production)).toEqual({
      status: 'unhandled',
    });
    expect(parseDeepLink('exp://user:pass@evil.example/--/pagos', production)).toEqual({
      status: 'unhandled',
    });
    expect(parseDeepLink(`duerecord://notificaciones/${UUID}`, production)).toEqual({
      status: 'notification',
      nid: UUID,
    });
    expect(resolveDeepLink(`${EXPO_GO}notificaciones/${UUID}`, false, production)).toEqual({
      action: 'ignore',
    });
    expect(handledDeepLinkUrl(`${EXPO_GO}notificaciones/${UUID}?access_token=${SECRET}`, production)).toBeNull();

    const dev = { dev: true, executionEnvironment: 'bare' };
    expect(parseDeepLink(`${EXPO_GO}notificaciones/${UUID}`, dev)).toEqual({
      status: 'notification',
      nid: UUID,
    });

    const expoGo = { dev: false, executionEnvironment: 'storeClient' };
    expect(parseDeepLink(`${EXPO_GO}pagos?token=abc`, expoGo)).toEqual({
      status: 'tab',
      screen: 'Pagos',
    });
    expect(createLinkingOptions({ ...production, expoGoPrefix: EXPO_GO }).prefixes).toEqual(['duerecord://']);
    expect(createLinkingOptions({ ...dev, expoGoPrefix: EXPO_GO }).prefixes).toEqual(['duerecord://', EXPO_GO]);
    expect(createLinkingOptions({ ...expoGo, expoGoPrefix: EXPO_GO }).prefixes).toEqual(['duerecord://', EXPO_GO]);
  });

  it('parses an Expo Go link the same way as duerecord', () => {
    expect(parseDeepLink(`${EXPO_GO}notificaciones/${UUID}?access_token=${SECRET}`)).toEqual(
      parseDeepLink(`duerecord://notificaciones/${UUID}`),
    );
    expect(parseDeepLink(`${EXPO_GO}pagos?token=abc`)).toEqual(parseDeepLink('duerecord://pagos?token=abc'));
    expect(parseDeepLink(`${EXPO_GO}notificaciones/${UUID}`)).toEqual({
      status: 'notification',
      nid: UUID,
    });
  });

  it('does not parse exp:// or exps:// in a production build, including an arbitrary host', () => {
    const runtime = currentDevPrefixEnv();
    const expoNotification = `${EXPO_GO}notificaciones/${UUID}?access_token=${SECRET}`;
    expect(allowsDevPrefix(PRODUCTION)).toBe(false);
    expect(allowsDevPrefix(DEV_BUILD)).toBe(true);
    expect(allowsDevPrefix(EXPO_GO_ENV)).toBe(true);
    expect(allowsDevPrefix(runtime)).toBe(parseDeepLink(expoNotification).status === 'notification');

    const blocked = [
      expoNotification,
      `exp://evil.example/--/notificaciones/${UUID}`,
      `exp://user:pass@evil.example:19000/--/notificaciones/${UUID}`,
      `exps://evil.example/--/pagos`,
      `exp://127.0.0.1:8081/notificaciones/${UUID}`,
    ];
    for (const url of blocked) {
      expect(parseDeepLink(url, PRODUCTION)).toEqual({ status: 'unhandled' });
      expect(resolveDeepLink(url, true, PRODUCTION)).toEqual({ action: 'ignore' });
      expect(handledDeepLinkUrl(url, PRODUCTION)).toBeNull();
    }
    expect(parseDeepLink(`duerecord://notificaciones/${UUID}`, PRODUCTION)).toEqual({
      status: 'notification',
      nid: UUID,
    });
    expect(parseDeepLink(`exp://evil.example/--/notificaciones/${UUID}`, DEV_BUILD)).toEqual({
      status: 'notification',
      nid: UUID,
    });
  });

  it('accepts only a uuid and the exact notificaciones segments', () => {
    expect(parseDeepLink(`duerecord://notificaciones/${OTHER.toUpperCase()}`)).toEqual({
      status: 'notification',
      nid: OTHER.toUpperCase(),
    });
    expect(parseDeepLink('duerecord://notificaciones/../nid-1')).toEqual({ status: 'inicio' });
    expect(parseDeepLink(`duerecord://notificaciones/../${UUID}`)).toEqual({ status: 'inicio' });
    expect(parseDeepLink('duerecord://notificaciones//nid-1')).toEqual({ status: 'inicio' });
    expect(parseDeepLink('duerecord:///nid-1')).toEqual({ status: 'inicio' });
    expect(parseDeepLink(`duerecord://notificaciones/${UUID}/`)).toEqual({ status: 'inicio' });
    expect(parseDeepLink(`duerecord://:80/notificaciones/${UUID}`)).toEqual({ status: 'inicio' });
    expect(parseDeepLink(`duerecord://localhost:80/notificaciones/${UUID}`)).toEqual({ status: 'inicio' });
    expect(parseDeepLink('duerecord://notificaciones/Llama-al-5555')).toEqual({ status: 'inicio' });
    expect(parseDeepLink(`duerecord://user:pass@notificaciones/${UUID}`)).toEqual({ status: 'inicio' });
    expect(parseDeepLink('property-control://notificaciones/' + UUID)).toEqual({ status: 'unhandled' });
    expect(parseDeepLink(`exp://127.0.0.1:8081/notificaciones/${UUID}`)).toEqual({ status: 'unhandled' });
  });

  it('keeps secrets out of handled and generated URLs', () => {
    expect(handledDeepLinkUrl(POISONED)).toBe(`duerecord://notificaciones/${UUID}`);
    expect(handledDeepLinkUrl(POISONED)).not.toContain(SECRET);
    expect(handledDeepLinkUrl(POISONED)).not.toContain(REFRESH);
    expect(notificationDeepLink(UUID)).toBe(`duerecord://notificaciones/${UUID}`);
    expect(notificationDeepLink('Llama-al-5555')).toBeNull();
    expect(notificationDeepLink('../secret')).toBeNull();
    expect(handledDeepLinkUrl(`duerecord://user:pass@notificaciones/${UUID}`)).toBeNull();
    expect(resolveDeepLink(POISONED, false)).toEqual({ action: 'sign-in', pendingNid: UUID });
  });

  it('shows the not-found stub for a signed-in nid and never the nid', async () => {
    setHasSession(true);
    setInitialUrl(POISONED);
    render(<App />);

    expect(await screen.findByText(COPY['notif.notFound.title'])).toBeTruthy();
    expect(screen.getByText(COPY['notif.notFound.body'])).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY['notif.notFound.cta'] })).toBeTruthy();
    expect(treeText()).not.toContain(UUID);
    expect(treeText()).not.toContain(SECRET);
    expect(treeText()).not.toContain(REFRESH);
    expect(treeText()).not.toContain('access_token');
    expect(screen.queryByText('Entrar')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: COPY['notif.notFound.cta'] }));
    expect(await screen.findByTestId('tab-Inicio')).toBeTruthy();
    expect(treeText()).not.toContain(UUID);
  });

  it('holds a pending notification nid in memory only', async () => {
    setHasSession(false);
    setInitialUrl(`duerecord://notificaciones/${UUID}?access_token=${SECRET}&refresh_token=${REFRESH}`);
    render(<App />);

    expect(await screen.findByText(COPY['notif.signIn.body'])).toBeTruthy();
    const text = treeText();
    expect(text).not.toContain(UUID);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(REFRESH);
    expect(text).not.toContain('access_token');
    expect(screen.queryByTestId('notification-detail')).toBeNull();
    expect(resolveDeepLink(`duerecord://notificaciones/${UUID}`, false)).toEqual({
      action: 'sign-in',
      pendingNid: UUID,
    });
  });

  it('holds the link on sign-in and opens the stub after a real session', async () => {
    setHasSession(false);
    setInitialUrl(`duerecord://notificaciones/${UUID}`);
    const view = render(<App />);

    expect(await screen.findByText(COPY['notif.signIn.body'])).toBeTruthy();
    expect(treeText()).not.toContain(UUID);
    expect(screen.queryByText('Entrar')).toBeNull();
    const readsAfterSignIn = readCount();
    expect(readsAfterSignIn).toBeGreaterThan(0);

    setHasSession(true);
    view.rerender(<App />);
    expect(readCount()).toBe(readsAfterSignIn);
    expect(screen.getByText(COPY['notif.signIn.body'])).toBeTruthy();
    expect(screen.queryByText(COPY['notif.notFound.title'])).toBeNull();
    view.unmount();

    const opened = render(<App />);
    expect(await screen.findByText(COPY['notif.notFound.title'])).toBeTruthy();
    expect(treeText()).not.toContain(UUID);
    expect(settleHeld({ kind: 'notification', nid: UUID }, true).held).toBeNull();
    opened.unmount();
  });

  it('clears a held nid when the notification opens or sign-in drops it', () => {
    const held = { kind: 'notification' as const, nid: UUID };
    expect(settleHeld(held, false)).toEqual({ place: { name: 'sign-in' }, held });
    expect(settleHeld(held, true)).toEqual({ place: { name: 'notification' }, held: null });
    expect(dropHeld()).toEqual({ place: { name: 'inicio', tabUrl: null }, held: null });
    expect(settleHeld({ kind: 'tab', screen: 'Pagos' }, false)).toEqual({
      place: { name: 'inicio', tabUrl: 'duerecord://pagos' },
      held: null,
    });
    expect(settleHeld({ kind: 'inicio' }, true).held).toBeNull();

    const source = fs.readFileSync(path.join(__dirname, 'AppShell.tsx'), 'utf8');
    expect(source).toContain('settleHeld');
    expect(source).toContain('dropHeld');
    expect(source.match(/setHeld\(null\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toContain('readSession()');
    expect(source).toContain('useHasSession');
    expect(source).toContain("COPY['notif.signIn.body']");
    expect(source).toContain("COPY['notif.signIn.notNow']");
    expect(source).toContain("COPY['notif.signIn.cancel']");
    expect(source).not.toContain('Inicia sesión');
  });

  it('drops a signed-out link on Ahora no and on Cancelar', async () => {
    setInitialUrl(`duerecord://notificaciones/${UUID}`);
    const first = render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: COPY['notif.signIn.notNow'] }));
    expect(await screen.findByTestId('tab-Inicio')).toBeTruthy();
    expect(treeText()).not.toContain(UUID);
    first.unmount();

    setInitialUrl(`duerecord://notificaciones/${OTHER}`);
    const second = render(<App />);
    fireEvent.press(await screen.findByRole('button', { name: COPY['notif.signIn.cancel'] }));
    expect(await screen.findByTestId('tab-Inicio')).toBeTruthy();
    expect(treeText()).not.toContain(OTHER);
    second.unmount();
  });

  it('opens Inicio for a crafted nid, a dot-dot path, an empty segment, a trailing slash, and a port', async () => {
    const urls = [
      'duerecord://notificaciones/Llama-al-5555',
      'duerecord://notificaciones/../nid-1',
      'duerecord://notificaciones//nid-1',
      `duerecord://notificaciones/${UUID}/`,
      `duerecord://:80/notificaciones/${UUID}`,
      `duerecord://localhost:80/notificaciones/${UUID}`,
    ];
    for (const url of urls) {
      setInitialUrl(url);
      const view = render(<App />);
      expect(await screen.findByTestId('tab-Inicio')).toBeTruthy();
      expect(screen.queryByTestId('notification-detail')).toBeNull();
      const text = treeText();
      expect(text).not.toContain('Llama-al-5555');
      expect(text).not.toContain('nid-1');
      expect(text).not.toContain(UUID);
      expect(text).not.toContain('localhost');
      expect(text).not.toContain('pass');
      view.unmount();
    }
  });

  it('does not let a query string become Pagos or Inicio params, or text on screen', async () => {
    setInitialUrl('duerecord://pagos?token=abc&code=1');
    const pagos = render(<App />);
    expect(await screen.findByText(TAB_BODIES.Pagos)).toBeTruthy();
    expect(treeText()).not.toContain('token');
    expect(treeText()).not.toContain('abc');
    expect(treeText()).not.toContain('code=1');
    pagos.unmount();

    setInitialUrl(`duerecord://?access_token=${SECRET}`);
    const inicio = render(<App />);
    expect(await screen.findByTestId('tab-Inicio')).toBeTruthy();
    expect(treeText()).not.toContain('access_token');
    expect(treeText()).not.toContain(SECRET);
    inicio.unmount();
  });

  it('ignores the property-control scheme and leaves the open stub in place', async () => {
    setHasSession(true);
    setInitialUrl(`duerecord://notificaciones/${OTHER}`);
    render(<App />);
    expect(await screen.findByTestId('notification-detail')).toBeTruthy();

    await act(async () => {
      emitUrl(`property-control://notificaciones/${UUID}?access_token=${SECRET}`);
    });
    expect(screen.getByTestId('notification-detail')).toBeTruthy();
    expect(treeText()).not.toContain(UUID);
    expect(treeText()).not.toContain(OTHER);
    expect(treeText()).not.toContain(SECRET);
    expect(resolveDeepLink(`property-control://notificaciones/${UUID}`, true)).toEqual({ action: 'ignore' });
  });
});
