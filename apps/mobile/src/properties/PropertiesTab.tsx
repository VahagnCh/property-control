import { useState } from 'react';
import type { ApiClient } from '../api/client';
import { EmailSignInScreen } from '../screens/EmailSignInScreen';
import { useSessionSnapshot } from '../session/useHasSession';
import { ObligationFormScreen } from './ObligationFormScreen';
import { PropertyDetailScreen } from './PropertyDetailScreen';
import { PropertyFormScreen } from './PropertyFormScreen';
import { PropertyListScreen } from './PropertyListScreen';

type Route =
  | { name: 'list' }
  | { name: 'create-property' }
  | { name: 'detail'; propertyId: string }
  | { name: 'create-obligation'; propertyId: string };

/**
 * Propiedades. Without a session this is the sign-in screen and no list is
 * requested. A missing client also refuses to show rows.
 */
export function PropertiesTab({ client }: { client: ApiClient | null }) {
  const session = useSessionSnapshot();
  const [route, setRoute] = useState<Route>({ name: 'list' });

  if (session.unavailable) {
    return null;
  }
  if (!session.signedIn || !client) {
    return <EmailSignInScreen embedded />;
  }

  if (route.name === 'create-property') {
    return (
      <PropertyFormScreen
        client={client}
        onCancel={() => setRoute({ name: 'list' })}
        onCreated={(propertyId) => setRoute({ name: 'detail', propertyId })}
      />
    );
  }
  if (route.name === 'detail') {
    return (
      <PropertyDetailScreen
        client={client}
        propertyId={route.propertyId}
        onBack={() => setRoute({ name: 'list' })}
        onAddObligation={() => setRoute({ name: 'create-obligation', propertyId: route.propertyId })}
      />
    );
  }
  if (route.name === 'create-obligation') {
    return (
      <ObligationFormScreen
        client={client}
        propertyId={route.propertyId}
        onCancel={() => setRoute({ name: 'detail', propertyId: route.propertyId })}
        onCreated={() => setRoute({ name: 'detail', propertyId: route.propertyId })}
      />
    );
  }
  return (
    <PropertyListScreen
      client={client}
      onCreate={() => setRoute({ name: 'create-property' })}
      onOpen={(propertyId) => setRoute({ name: 'detail', propertyId })}
    />
  );
}
