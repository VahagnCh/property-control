import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';

const Tab = createBottomTabNavigator();

export function AppTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerTitleAlign: 'center',
        tabBarActiveTintColor: '#0F6E56',
        tabBarInactiveTintColor: '#5C6B66',
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tab.Screen name="Inicio">
        {() => (
          <PlaceholderScreen
            title="Inicio"
            body="Aquí verás lo atrasado y lo que vence pronto en todas tus propiedades."
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Propiedades">
        {() => (
          <PlaceholderScreen
            title="Propiedades"
            body="El portafolio y, dentro de cada propiedad, sus obligaciones."
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Pagos">
        {() => (
          <PlaceholderScreen
            title="Pagos"
            body="Registrar un pago anota lo que ya pagaste. El comprobante es opcional. Esta app no mueve dinero."
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Mantenimiento">
        {() => (
          <PlaceholderScreen
            title="Mantenimiento"
            body="Tareas ligeras de la propiedad. El flujo completo llega después."
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Documentos">
        {() => (
          <PlaceholderScreen
            title="Documentos"
            body="Los archivos de cada propiedad viven aquí. La pantalla para revisar sugerencias de OCR y confirmarlas llega después. Nada se guarda en obligaciones o pagos hasta que la persona confirma."
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
}
