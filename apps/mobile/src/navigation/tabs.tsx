import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import type { ApiClient } from '../api/client';
import type { ScreenPhase } from '../components/ScreenState';
import { TAB_BODIES, TAB_LABELS, TabLabel } from '../copy/userFacing';
import type { MembershipRole } from '../payments/voidPayment';
import { PropertiesTab } from '../properties/PropertiesTab';
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

function PropertiesRoute({
  client,
  role,
}: {
  client: ApiClient | null;
  role: MembershipRole | null;
}) {
  const navigation = useNavigation<NavigationProp<Record<string, object | undefined>>>();
  return (
    <PropertiesTab
      client={client}
      role={role}
      onInicio={() => {
        navigation.navigate('Inicio');
      }}
    />
  );
}

export function AppTabs({
  phase = 'ready',
  onRetry,
  propertyClient = null,
  role = null,
}: {
  phase?: ScreenPhase;
  onRetry?: (tab: TabLabel) => void;
  propertyClient?: ApiClient | null;
  role?: MembershipRole | null;
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
          {() =>
            phase === 'ready' && name === 'Propiedades' ? (
              <PropertiesRoute client={propertyClient} role={role} />
            ) : (
              <PlaceholderScreen
                title={name}
                body={TAB_BODIES[name]}
                phase={phase}
                onRetry={onRetry ? () => onRetry(name) : undefined}
              />
            )
          }
        </Tab.Screen>
      ))}
    </Tab.Navigator>
  );
}
