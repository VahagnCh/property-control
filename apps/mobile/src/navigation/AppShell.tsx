import { NavigationContainer } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { resolveDeepLink } from './deepLink';
import { linking } from './linking';
import { AppTabs } from './tabs';

type Place =
  | { name: 'inicio' }
  | { name: 'sign-in'; pendingNid: string }
  | { name: 'notification'; nid: string };

/**
 * Opens duerecord://notificaciones/<nid>. A session shows that notification.
 * No session shows sign-in, then the same nid, or Inicio if the person drops it.
 * Any other duerecord path, and a malformed nid, show Inicio. Other schemes are ignored.
 */
export function AppShell({
  url = null,
  hasSession = false,
}: {
  url?: string | null;
  hasSession?: boolean;
}) {
  const [session, setSession] = useState(hasSession);
  const [place, setPlace] = useState<Place>({ name: 'inicio' });

  useEffect(() => {
    if (!url) {
      return;
    }
    const next = resolveDeepLink(url, session);
    if (next.action === 'ignore') {
      return;
    }
    if (next.action === 'inicio') {
      setPlace({ name: 'inicio' });
      return;
    }
    if (next.action === 'notification') {
      setPlace({ name: 'notification', nid: next.nid });
      return;
    }
    setPlace({ name: 'sign-in', pendingNid: next.pendingNid });
  }, [url, session]);

  if (place.name === 'sign-in') {
    return (
      <View>
        <Text>Inicia sesión para abrir esta notificación.</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Entrar"
          onPress={() => {
            setSession(true);
            setPlace({ name: 'notification', nid: place.pendingNid });
          }}
        >
          <Text>Entrar</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ahora no"
          onPress={() => {
            setPlace({ name: 'inicio' });
          }}
        >
          <Text>Ahora no</Text>
        </Pressable>
      </View>
    );
  }

  if (place.name === 'notification') {
    return (
      <View>
        <Text testID="notification-detail">Notificación</Text>
        <Text testID="notification-nid">{place.nid}</Text>
      </View>
    );
  }

  return (
    <NavigationContainer linking={linking}>
      <AppTabs />
    </NavigationContainer>
  );
}
