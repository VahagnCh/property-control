import { fireEvent, screen } from '@testing-library/react-native';
import { Dimensions, PixelRatio } from 'react-native';
import { TAB_BODIES, TAB_LABELS } from '../copy/userFacing';
import { renderTabs } from '../test/renderTabs';
import { BRAND_TEAL } from '../theme/brand';
import { tabScreenOptions } from './tabs';

function tabNodes() {
  return TAB_LABELS.map((label) => screen.getByTestId(`tab-${label}`));
}

function expectAccessibleTabsInOrder() {
  const tabs = tabNodes();
  expect(tabs.map((node) => node.props.accessibilityLabel)).toEqual([...TAB_LABELS]);
  for (const node of tabs) {
    const role = node.props.role ?? node.props.accessibilityRole;
    expect(role).toBe('button');
  }
  const ordered = screen
    .getAllByRole('button')
    .map((node) => node.props.accessibilityLabel)
    .filter((label): label is string => (TAB_LABELS as readonly string[]).includes(String(label)));
  expect(ordered).toEqual([...TAB_LABELS]);
  return tabs;
}

describe('bottom tabs', () => {
  it('renders exactly five tabs in order with accessible labels', () => {
    renderTabs();
    expectAccessibleTabsInOrder();
    expect(screen.getAllByText('DueRecord').length).toBeGreaterThan(0);
    expect(tabScreenOptions.tabBarActiveTintColor).toBe(BRAND_TEAL);
    expect(BRAND_TEAL).toBe('#0F3D3E');
  });

  it('says DueRecord does not move money and that the comprobante is optional', () => {
    renderTabs();
    fireEvent.press(screen.getByTestId('tab-Pagos'));
    expect(screen.getByText(TAB_BODIES.Pagos)).toBeTruthy();
    expect(TAB_BODIES.Pagos).toContain('DueRecord no mueve dinero');
    expect(TAB_BODIES.Pagos.toLowerCase()).toContain('comprobante es opcional');
  });

  it('keeps all five tab labels accessible on a 320x568 window at fontScale 2', () => {
    Dimensions.set({
      window: { width: 320, height: 568, scale: 2, fontScale: 2 },
      screen: { width: 320, height: 568, scale: 2, fontScale: 2 },
    });
    expect(PixelRatio.getFontScale()).toBeCloseTo(2, 1);
    renderTabs(undefined, { width: 320, height: 568 });
    expectAccessibleTabsInOrder();
    for (const label of TAB_LABELS) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });
});
