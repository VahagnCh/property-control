import { NavigationContainer } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { ApiClient } from '../api/client';
import { COPY } from '../copy/userFacing';
import { LaunchHealth } from '../health/HealthBanner';
import { EmailSignInScreen } from '../screens/EmailSignInScreen';
import { hydrateSession } from '../session/loadSession';
import { markHydrateTimedOut } from '../session/readSession';
import type { MembershipRole } from '../payments/voidPayment';
import { SessionUnavailable } from '../session/SessionUnavailable';
import { useHasSession, useSessionSnapshot } from '../session/useHasSession';
import { parseDeepLink } from './deepLink';
import { dropHeld, settleHeld, type Held, type Place } from './heldLink';
import { linking } from './linking';
import { liveAppClient } from './liveClient';
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
 * Subscribes to the real linking URL and to the in-memory session.
 * A notification link stays on sign-in until that session is signed in.
 * Ahora no and Cancelar drop it and open Inicio. The notification screen is a
 * stub: every nid gets the same not-found copy. A held nid is cleared once it
 * is opened or dropped. A secure-store read failure shows connecting, not sign-in.
 */
export const HYDRATE_TIMEOUT_MS = 15_000;

export function AppShell({
  apiClient,
  role = null,
  hydrate = hydrateSession,
  hydrateTimeoutMs = HYDRATE_TIMEOUT_MS,
}: {
  apiClient?: ApiClient | null;
  role?: MembershipRole | null;
  hydrate?: () => Promise<void>;
  hydrateTimeoutMs?: number;
} = {}) {
  const hasSession = useHasSession();
  const session = useSessionSnapshot();
  const [held, setHeld] = useState<Held | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [place, setPlace] = useState<Place>({ name: 'inicio', tabUrl: null });

  useEffect(() => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        markHydrateTimedOut();
      }
    }, hydrateTimeoutMs);
    void hydrate()
      .catch(() => undefined)
      .finally(() => {
        settled = true;
        clearTimeout(timer);
      });
    return () => {
      settled = true;
      clearTimeout(timer);
    };
  }, [hydrate, hydrateTimeoutMs]);

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

  const sharedClient = apiClient === undefined ? liveAppClient() : apiClient;

  useEffect(() => {
    if (!sharedClient) {
      return undefined;
    }
    return sharedClient.watchSession();
  }, [sharedClient]);

  const health = sharedClient ? <LaunchHealth client={sharedClient} /> : null;

  if (session.hydrated === false && session.hydrateTimedOut) {
    return (
      <View testID="hydrate-timeout" style={{ flex: 1 }}>
        {health}
        <EmailSignInScreen embedded client={sharedClient ?? undefined} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={COPY['common.retry']}
          onPress={() => {
            void hydrate();
          }}
        >
          <Text>{COPY['common.retry']}</Text>
        </Pressable>
      </View>
    );
  }

  if (session.hydrated === false) {
    return (
      <View testID="session-loading" style={{ flex: 1, padding: 24, gap: 12 }}>
        <ActivityIndicator />
        <Text>{COPY['common.connecting']}</Text>
      </View>
    );
  }

  if (session.unavailable) {
    return <SessionUnavailable />;
  }

  if (session.expired) {
    return (
      <View style={{ flex: 1 }}>
        {health}
        <EmailSignInScreen expired client={sharedClient ?? undefined} />
      </View>
    );
  }

  if (place.name === 'sign-in') {
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, gap: 16 }}>
        {health}
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
        <EmailSignInScreen embedded client={sharedClient ?? undefined} />
      </ScrollView>
    );
  }

  if (place.name === 'notification') {
    return <NotificationStub onInicio={leaveToInicio} />;
  }

  const dataClient = hasSession ? sharedClient : null;

  return (
    <View style={{ flex: 1 }}>
      {health}
      <NavigationContainer
        key={place.tabUrl ?? 'inicio'}
        linking={{
          ...linking,
          getInitialURL: () => place.tabUrl,
          subscribe: () => () => {},
        }}
      >
        <AppTabs propertyClient={dataClient} role={role} />
      </NavigationContainer>
    </View>
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
