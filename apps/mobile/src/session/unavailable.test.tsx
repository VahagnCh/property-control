import { fireEvent, render, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { ReactNode } from 'react';
import { COPY } from '../copy/userFacing';
import App from '../../App';

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `exp://127.0.0.1:8081/--${path.startsWith('/') ? path : `/${path}`}`,
  getInitialURL: jest.fn(async () => null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  isAvailableAsync: jest.fn(async () => true),
  setItemAsync: jest.fn(async () => undefined),
  getItemAsync: jest.fn(async () => {
    throw new Error('disk down');
  }),
  deleteItemAsync: jest.fn(async () => undefined),
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

describe('secure store read failure', () => {
  it('shows connecting retry and does not show sign-in or clear the store', async () => {
    render(<App />);
    expect(await screen.findByText(COPY['common.connecting.failed'])).toBeTruthy();
    expect(screen.getByRole('button', { name: COPY['common.retry'] })).toBeTruthy();
    expect(screen.queryByText(COPY['auth.email.title'])).toBeNull();
    expect(screen.queryByText(COPY['auth.session.expired'])).toBeNull();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();

    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    fireEvent.press(screen.getByRole('button', { name: COPY['common.retry'] }));
    expect(await screen.findByTestId('tab-Inicio')).toBeTruthy();
    expect(screen.queryByText(COPY['auth.email.title'])).toBeNull();
  });
});
