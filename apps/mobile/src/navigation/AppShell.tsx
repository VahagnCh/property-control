import { NavigationContainer } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { COPY } from '../copy/userFacing';
import { readSession } from '../session/readSession';
import { parseDeepLink, tabDeepLink, type TabScreen } from './deepLink';
import { linking } from './linking';
import { AppTabs } from './tabs';

type Place =
  | { name: 'inicio'; tabUrl: string | null }
  | { name: 'sign-in' }
  | { name: 'notification' };

/** The nid stays here and is never passed into the rendered tree. */
type Held =
  | { kind: 'notification'; nid: string }
  | { kind: 'tab'; screen: TabScreen }
  | { kind: 'inicio' };

const SIGN_IN_BODY = 'Inicia sesión para abrir esta notificación.';

function holdFromUrl(url: string): Held | null {
  const parsed = parseDeepLink(url);
  if (parsed.status === 'unhandled') {
    return null;
  }
  if (parsed.status === 'notification') {
    return { kind: 'notification', nid: parsed.nid };
  }
  if (parsed.status === 'tab') {
    return { kind: 'tab', screen: parsed.screen };
  }
  return { kind: 'inicio' };
}

/**
 * Subscribes to the real linking URL. There is no session until auth storage exists,
 * so a notification link stops on sign-in. Ahora no and Cancelar drop it and open Inicio.
 * The notification screen is a stub: every nid gets the same not-found copy.
 */
export function AppShell() {
  const hasSession = readSession();
  const [held, setHeld] = useState<Held | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [place, setPlace] = useState<Place>({ name: 'inicio', tabUrl: null });

  useEffect(() => {
    let alive = true;
    let sawEvent = false;
    const apply = (url: string) => {
      if (!alive) {
        return;
      }
      const next = holdFromUrl(url);
      if (!next) {
        return;
      }
      setDismissed(false);
      setHeld(next);
    };
    void Linking.getInitialURL()
      .then((initial) => {
        if (sawEvent || !initial) {
          return;
        }
        apply(initial);
      })
      .catch(() => undefined);
    const subscription = Linking.addEventListener('url', (event) => {
      sawEvent = true;
      apply(event.url);
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!held || dismissed) {
      return;
    }
    if (held.kind === 'notification') {
      setPlace(hasSession ? { name: 'notification' } : { name: 'sign-in' });
      return;
    }
    if (held.kind === 'tab') {
      setPlace({ name: 'inicio', tabUrl: tabDeepLink(held.screen) });
      return;
    }
    setPlace({ name: 'inicio', tabUrl: null });
  }, [held, dismissed, hasSession]);

  function leaveToInicio() {
    setDismissed(true);
    setPlace({ name: 'inicio', tabUrl: null });
  }

  if (place.name === 'sign-in') {
    return (
      <View>
        <Text>{SIGN_IN_BODY}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Ahora no" onPress={leaveToInicio}>
          <Text>Ahora no</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancelar" onPress={leaveToInicio}>
          <Text>Cancelar</Text>
        </Pressable>
      </View>
    );
  }

  if (place.name === 'notification') {
    return <NotificationStub onInicio={leaveToInicio} />;
  }

  return (
    <NavigationContainer
      key={place.tabUrl ?? 'inicio'}
      linking={{
        ...linking,
        getInitialURL: () => place.tabUrl,
        subscribe: () => () => {},
      }}
    >
      <AppTabs />
    </NavigationContainer>
  );
}

/** Stub until the API fetch and membership check land. The same copy for every nid. */
function NotificationStub({ onInicio }: { onInicio: () => void }) {
  return (
    <View testID="notification-detail">
      <Text>{COPY['notif.notFound.title']}</Text>
      <Text>{COPY['notif.notFound.body']}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={COPY['notif.notFound.cta']}
        onPress={onInicio}
      >
        <Text>{COPY['notif.notFound.cta']}</Text>
      </Pressable>
    </View>
  );
}
