import { screen } from '@testing-library/react-native';
import { ReactNode } from 'react';
import { COPY } from '../copy/userFacing';
import { AppShell } from '../navigation/AppShell';
import { renderWithSafeArea } from '../test/renderTabs';
import { resetSessionState } from './readSession';

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
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        },
        children,
      }),
  };
});

describe('hydrate timeout', () => {
  beforeEach(() => {
    resetSessionState();
  });

  it('fails closed to sign-in with Reintentar and shows no property data', async () => {
    renderWithSafeArea(
      <AppShell
        apiClient={null}
        hydrate={() => new Promise(() => undefined)}
        hydrateTimeoutMs={20}
      />,
    );
    expect(await screen.findByText(COPY['auth.email.title'])).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY['common.retry'] })).toBeTruthy();
    expect(screen.queryByTestId('tab-Inicio')).toBeNull();
    expect(screen.queryByText('Casa')).toBeNull();
    expect(screen.queryByText('CFE')).toBeNull();
  });
});
