import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { resetSessionState, setSessionSignedIn } from './readSession';
import { useHasSession } from './useHasSession';

function Probe() {
  const hasSession = useHasSession();
  return <Text>{hasSession ? 'signed-in' : 'signed-out'}</Text>;
}

describe('useHasSession', () => {
  beforeEach(() => {
    resetSessionState();
  });

  it('updates when the session changes and a rerender does not drop that update', () => {
    const view = render(<Probe />);
    expect(screen.getByText('signed-out')).toBeTruthy();
    view.rerender(<Probe />);
    expect(screen.getByText('signed-out')).toBeTruthy();

    act(() => {
      setSessionSignedIn();
    });
    expect(screen.getByText('signed-in')).toBeTruthy();
    view.rerender(<Probe />);
    expect(screen.getByText('signed-in')).toBeTruthy();
  });
});
