import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ApiClient } from '../api/client';
import { ApiClientError } from '../api/errors';
import type { PropertyResponse } from '../api/contract';
import type { MembershipRole } from '../payments/voidPayment';
import { ScreenState } from '../components/ScreenState';
import { COPY } from '../copy/userFacing';
import { PrimaryButton } from './fields';
import { PROPERTY_TYPE_OPTIONS, optionLabel } from './labels';

type Phase = 'loading' | 'empty' | 'error' | 'forbidden' | 'ready';

export function PropertyListScreen({
  client,
  role = null,
  onOpen,
  onCreate,
}: {
  client: ApiClient;
  role?: MembershipRole | null;
  onOpen: (propertyId: string) => void;
  onCreate: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [items, setItems] = useState<PropertyResponse[]>([]);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const page = await client.listProperties();
      setItems(page.items);
      setPhase(page.items.length === 0 ? 'empty' : 'ready');
    } catch (error) {
      setItems([]);
      if (error instanceof ApiClientError && error.status === 403) {
        setPhase('forbidden');
        return;
      }
      setPhase('error');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase === 'forbidden') {
    return (
      <View style={styles.pad}>
        <Text accessibilityRole="alert">{COPY['err.forbidden']}</Text>
      </View>
    );
  }

  if (phase === 'loading' || phase === 'error') {
    return (
      <View style={styles.pad}>
        <ScreenState phase={phase} contextLabel={COPY['cta.addProperty']} onRetry={() => void load()} />
      </View>
    );
  }

  if (phase === 'empty') {
    return (
      <View style={styles.pad}>
        <Text accessibilityRole="text">{COPY['property.empty.title']}</Text>
        {role === 'viewer' ? null : (
          <PrimaryButton label={COPY['cta.addProperty']} onPress={onCreate} testID="property-add" />
        )}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      {role === 'viewer' ? null : (
        <PrimaryButton label={COPY['cta.addProperty']} onPress={onCreate} testID="property-add" />
      )}
      {items.map((property) => (
        <Pressable
          key={property.id}
          accessibilityRole="button"
          accessibilityLabel={property.name}
          onPress={() => onOpen(property.id)}
          style={styles.card}
        >
          <Text style={styles.name}>{property.name}</Text>
          <Text>{optionLabel(PROPERTY_TYPE_OPTIONS, property.propertyType)}</Text>
          {property.city ? <Text>{property.city}</Text> : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: {
    gap: 16,
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    gap: 4,
    padding: 16,
  },
  name: {
    color: '#14221E',
    fontSize: 20,
    fontWeight: '700',
  },
});
