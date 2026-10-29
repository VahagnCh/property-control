import { NavigationContainer } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { COPY } from '../copy/userFacing';
import { useHasSession } from '../session/useHasSession';
import { parseDeepLink } from './deepLink';
import { dropHeld, settleHeld, type Held, type Place } from './heldLink';
import { linking } from './linking';
import { AppTabs } from './tabs';

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
 * Subscribes to the real linking URL. Session is read once per mount until auth
 * subscribes, so a notification link stops on sign-in. Ahora no and Cancelar drop
 * it and open Inicio. The notification screen is a stub: every nid gets the same
 * not-found copy. A held nid is cleared once it is opened or dropped.
 */
export function AppShell() {
  const hasSession = useHasSession();
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
    const next = settleHeld(held, hasSession);
    setPlace(next.place);
    if (next.held === null) {
      setHeld(null);
    }
  }, [held, dismissed, hasSession]);

  function leaveToInicio() {
    const next = dropHeld();
    setHeld(null);
    setDismissed(true);
    setPlace(next.place);
  }

  if (place.name === 'sign-in') {
    return (
      <View>
        <Text>{COPY['notif.signIn.body']}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={COPY['notif.signIn.notNow']}
          onPress={leaveToInicio}
        >
          <Text>{COPY['notif.signIn.notNow']}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={COPY['notif.signIn.cancel']}
          onPress={leaveToInicio}
        >
          <Text>{COPY['notif.signIn.cancel']}</Text>
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
