import { jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { ScreenPhase } from './ScreenState';
import {
  SCREEN_STATE_COPY,
  TAB_LABELS,
  emptyAccessibilityLabel,
  errorAccessibilityLabel,
  loadingAccessibilityLabel,
  retryAccessibilityLabel,
} from '../copy/userFacing';
import { renderTabs } from '../test/renderTabs';

const phases: Array<Exclude<ScreenPhase, 'ready'>> = ['empty', 'loading', 'error'];

describe('screen state on every tab', () => {
  it.each(phases)('shows the %s state on all five tabs', (phase) => {
    const onRetry = jest.fn();
    renderTabs({ phase, onRetry });
    const visible = { includeHiddenElements: true };

    for (const tab of TAB_LABELS) {
      if (phase === 'loading') {
        expect(screen.getByLabelText(loadingAccessibilityLabel(tab), visible)).toBeTruthy();
        expect(screen.getAllByText(SCREEN_STATE_COPY.loading, visible)).toHaveLength(TAB_LABELS.length);
      }
      if (phase === 'empty') {
        expect(screen.getByLabelText(emptyAccessibilityLabel(tab), visible)).toBeTruthy();
        expect(screen.getAllByText(SCREEN_STATE_COPY.empty, visible)).toHaveLength(TAB_LABELS.length);
      }
      if (phase === 'error') {
        expect(screen.getByLabelText(errorAccessibilityLabel(tab), visible)).toBeTruthy();
        expect(screen.getByLabelText(retryAccessibilityLabel(tab), visible)).toBeTruthy();
      }
    }

    if (phase === 'error') {
      for (const tab of TAB_LABELS) {
        fireEvent.press(screen.getByTestId(`tab-${tab}`));
        fireEvent.press(screen.getByLabelText(retryAccessibilityLabel(tab)));
      }
      expect(onRetry.mock.calls.map((call) => call[0])).toEqual([...TAB_LABELS]);
    } else {
      expect(screen.queryByText(SCREEN_STATE_COPY.retry)).toBeNull();
    }

    expect(screen.queryByText(/cobrar|transferir|wallet|banco|SAT|Hacienda/i)).toBeNull();
  });

  it('shows the placeholder body when the tab is ready', () => {
    renderTabs({ phase: 'ready' });
    expect(screen.queryByText(SCREEN_STATE_COPY.loading)).toBeNull();
    expect(screen.queryByText(SCREEN_STATE_COPY.empty)).toBeNull();
    expect(screen.queryByText(SCREEN_STATE_COPY.error)).toBeNull();
    expect(screen.getByText('Aquí verás lo atrasado y lo que vence pronto en todas tus propiedades.')).toBeTruthy();
  });
});
