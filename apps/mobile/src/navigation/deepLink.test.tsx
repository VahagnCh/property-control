import { fireEvent, render, screen } from '@testing-library/react-native';
import { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { renderWithSafeArea } from '../test/renderTabs';
import { AppShell } from './AppShell';
import { handledDeepLinkUrl, notificationDeepLink, resolveDeepLink } from './deepLink';
import { linking } from './linking';

const initialMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function shell(url: string, hasSession: boolean): ReactElement {
  return (
    <SafeAreaProvider initialMetrics={initialMetrics}>
      <AppShell url={url} hasSession={hasSession} />
    </SafeAreaProvider>
  );
}

const NID = 'nid-1';
const OTHER = 'nid-9';
const SECRET = 'sekret-access';
const REFRESH = 'sekret-refresh';
const POISONED = `duerecord://notificaciones/${NID}?access_token=${SECRET}&refresh_token=${REFRESH}#otp=${SECRET}`;

function open(url: string | null, hasSession = false) {
  return renderWithSafeArea(<AppShell url={url} hasSession={hasSession} />);
}

function expectNoSecret(value: string) {
  expect(value).not.toContain('access_token');
  expect(value).not.toContain('refresh_token');
  expect(value).not.toContain('otp');
  expect(value).not.toContain(SECRET);
  expect(value).not.toContain(REFRESH);
  expect(value).not.toContain('password');
  expect(value).not.toContain('secret');
}

describe('duerecord deep links', () => {
  it('registers only the duerecord scheme', () => {
    expect(linking.prefixes).toEqual(['duerecord://']);
  });

  it('opens the notification for that nid when a session exists', () => {
    open(`duerecord://notificaciones/${NID}`, true);
    expect(screen.getByTestId('notification-detail')).toBeTruthy();
    expect(screen.getByTestId('notification-nid').props.children).toBe(NID);
    expect(screen.queryByTestId('tab-Inicio')).toBeNull();
  });

  it('sends a signed-out person to sign-in and then to that notification', () => {
    open(`duerecord://notificaciones/${NID}`, false);
    expect(screen.getByText('Inicia sesión para abrir esta notificación.')).toBeTruthy();
    expect(screen.queryByTestId('notification-nid')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByTestId('notification-nid').props.children).toBe(NID);
  });

  it('drops a signed-out link and shows Inicio', async () => {
    open(`duerecord://notificaciones/${NID}`, false);
    fireEvent.press(screen.getByRole('button', { name: 'Ahora no' }));
    expect(await screen.findByTestId('tab-Inicio')).toBeTruthy();
    expect(screen.queryByTestId('notification-nid')).toBeNull();
  });

  it('falls back to Inicio for a malformed nid, an unknown path, or a secret in the userinfo', async () => {
    const urls = [
      'duerecord://notificaciones/',
      'duerecord://notificaciones/a/b',
      'duerecord://notificaciones/..',
      'duerecord://notificaciones/%20nid',
      'duerecord://ajustes',
      'duerecord://user:pass@notificaciones/nid-1',
      'not a url',
    ];
    for (const url of urls) {
      const view = open(url, true);
      expect(await screen.findByTestId('tab-Inicio')).toBeTruthy();
      expect(screen.queryByTestId('notification-nid')).toBeNull();
      expect(screen.queryByText('pass')).toBeNull();
      view.unmount();
    }
  });

  it('does not handle the property-control scheme', () => {
    const view = render(shell(`duerecord://notificaciones/${OTHER}`, true));
    expect(screen.getByTestId('notification-nid').props.children).toBe(OTHER);

    view.rerender(shell(`property-control://notificaciones/${NID}?access_token=${SECRET}`, true));
    expect(screen.getByTestId('notification-nid').props.children).toBe(OTHER);
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(resolveDeepLink(`property-control://notificaciones/${NID}`, true)).toEqual({ action: 'ignore' });
  });

  it('keeps access tokens, refresh tokens, and other secrets out of handled and generated URLs', () => {
    open(POISONED, true);
    expect(screen.getByTestId('notification-nid').props.children).toBe(NID);
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.queryByText(REFRESH)).toBeNull();

    const handled = handledDeepLinkUrl(POISONED);
    expect(handled).toBe(`duerecord://notificaciones/${NID}`);
    expectNoSecret(handled ?? '');

    const generated = notificationDeepLink(NID);
    expect(generated).toBe(`duerecord://notificaciones/${NID}`);
    expectNoSecret(generated ?? '');
    expect(generated).not.toContain('?');
    expect(generated).not.toContain('#');
    expect(generated).not.toContain('@');

    expect(notificationDeepLink('../secret')).toBeNull();
    expect(handledDeepLinkUrl(`duerecord://user:pass@notificaciones/${NID}`)).toBeNull();
  });
});
