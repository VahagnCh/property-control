import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as session from './readSession';
import { useHasSession } from './useHasSession';

jest.mock('./readSession', () => {
  let reads = 0;
  return {
    readSession: () => {
      reads += 1;
      return false;
    },
    __readCount: () => reads,
  };
});

function Probe() {
  const hasSession = useHasSession();
  return <Text>{hasSession ? 'signed-in' : 'signed-out'}</Text>;
}

describe('useHasSession', () => {
  it('reads the session once per mount and not again on rerender', () => {
    const view = render(<Probe />);
    expect(screen.getByText('signed-out')).toBeTruthy();
    const reads = (session as unknown as { __readCount: () => number }).__readCount();
    expect(reads).toBeGreaterThan(0);
    view.rerender(<Probe />);
    view.rerender(<Probe />);
    expect((session as unknown as { __readCount: () => number }).__readCount()).toBe(reads);
    expect(screen.getByText('signed-out')).toBeTruthy();
  });
});