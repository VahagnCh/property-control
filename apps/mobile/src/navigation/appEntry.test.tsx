import { act, render, screen } from '@testing-library/react-native';
import * as ExpoLinking from 'expo-linking';
import { ReactNode } from 'react';
import App from '../../App';

const UUID = '11111111-1111-4111-8111-111111111111';

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

describe('App linking entry', () => {
  it('reads the initial URL and a URL event from expo-linking, with no url or session props', async () => {
    (ExpoLinking.getInitialURL as jest.Mock).mockResolvedValue(
      `duerecord://notificaciones/${UUID}?access_token=sekret-access`,
    );
    const view = render(<App />);

    expect(await screen.findByText('Inicia sesión para abrir esta notificación.')).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toContain(UUID);
    expect(JSON.stringify(screen.toJSON())).not.toContain('sekret-access');
    expect(JSON.stringify(screen.toJSON())).not.toContain('access_token');

    const addEventListener = ExpoLinking.addEventListener as jest.Mock;
    const handler = addEventListener.mock.calls[addEventListener.mock.calls.length - 1]?.[1] as
      | ((event: { url: string }) => void)
      | undefined;
    expect(handler).toEqual(expect.any(Function));
    await act(async () => {
      handler?.({ url: 'duerecord://notificaciones/Llama-al-5555' });
    });

    expect(await screen.findByTestId('tab-Inicio')).toBeTruthy();
    const text = JSON.stringify(screen.toJSON());
    expect(text).not.toContain('Llama-al-5555');
    expect(text).not.toContain(UUID);
    expect(text).not.toContain('sekret-access');

    view.unmount();
    const subscription = addEventListener.mock.results[addEventListener.mock.results.length - 1]?.value as {
      remove: jest.Mock;
    };
    expect(subscription.remove).toHaveBeenCalled();
  });
});
