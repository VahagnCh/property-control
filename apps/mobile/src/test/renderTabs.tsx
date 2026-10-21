import { NavigationContainer } from '@react-navigation/native';
import { render } from '@testing-library/react-native';
import { ComponentProps, ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppTabs } from '../navigation/tabs';

const frame = { x: 0, y: 0, width: 390, height: 844 };

export function renderTabs(
  props?: ComponentProps<typeof AppTabs>,
  size: { width: number; height: number } = { width: frame.width, height: frame.height },
) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: size.width, height: size.height },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <NavigationContainer>
        <AppTabs {...props} />
      </NavigationContainer>
    </SafeAreaProvider>,
  );
}

export function renderWithSafeArea(ui: ReactElement, size = { width: 390, height: 844 }) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: size.width, height: size.height },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      {ui}
    </SafeAreaProvider>,
  );
}
