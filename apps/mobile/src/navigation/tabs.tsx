import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { ScreenPhase } from '../components/ScreenState';
import { TAB_BODIES, TAB_LABELS, TabLabel } from '../copy/userFacing';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { BRAND_TEAL, TAB_INACTIVE_TINT } from '../theme/brand';

const Tab = createBottomTabNavigator();

export const tabScreenOptions = {
  headerTitleAlign: 'center' as const,
  tabBarActiveTintColor: BRAND_TEAL,
  tabBarInactiveTintColor: TAB_INACTIVE_TINT,
  tabBarLabelStyle: { fontSize: 11 },
  lazy: false,
};

export function AppTabs({
  phase = 'ready',
  onRetry,
}: {
  phase?: ScreenPhase;
  onRetry?: (tab: TabLabel) => void;
}) {
  return (
    <Tab.Navigator screenOptions={tabScreenOptions}>
      {TAB_LABELS.map((name) => (
        <Tab.Screen
          key={name}
          name={name}
          options={{
            tabBarAccessibilityLabel: name,
            tabBarButtonTestID: `tab-${name}`,
            tabBarAllowFontScaling: true,
          }}
        >
          {() => (
            <PlaceholderScreen
              title={name}
              body={TAB_BODIES[name]}
              phase={phase}
              onRetry={onRetry ? () => onRetry(name) : undefined}
            />
          )}
        </Tab.Screen>
      ))}
    </Tab.Navigator>
  );
}
