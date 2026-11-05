import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ApiClient } from '../api/client';
import { ApiClientError } from '../api/errors';
import type { ObligationResponse, PropertyResponse } from '../api/contract';
import { ScreenState } from '../components/ScreenState';
import { COPY, copyText } from '../copy/userFacing';
import { formatMxnDisplay, parseMxnToCentavos } from '../payments/money';
import { PrimaryButton } from './fields';
import { CATEGORY_OPTIONS, PROPERTY_TYPE_OPTIONS, optionLabel } from './labels';

type MembershipRole = 'owner' | 'member' | 'viewer';
type Phase = 'loading' | 'error' | 'notFound' | 'ready';

function amountLabel(amount: string | null | undefined) {
  if (typeof amount !== 'string' || amount === '') {
    return null;
  }
  try {
    return <Text>{formatMxnDisplay(parseMxnToCentavos(amount))}</Text>;
  } catch {
    return null;
  }
}

export function PropertyDetailScreen({
  client,
  propertyId,
  role = 'owner',
  onAddObligation,
  onBack,
}: {
  client: ApiClient;
  propertyId: string;
  role?: MembershipRole;
  onAddObligation: () => void;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [property, setProperty] = useState<PropertyResponse | null>(null);
  const [obligations, setObligations] = useState<ObligationResponse[]>([]);
  const [readOnly, setReadOnly] = useState(role === 'viewer');

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const [nextProperty, page] = await Promise.all([
        client.getProperty(propertyId),
        client.listObligations(propertyId),
      ]);
      setProperty(nextProperty);
      setObligations(page.items);
      setPhase('ready');
    } catch (error) {
      if (error instanceof ApiClientError && (error.status === 404 || error.code === 'not_found')) {
        setProperty(null);
        setObligations([]);
        setPhase('notFound');
        return;
      }
      if (error instanceof ApiClientError && error.status === 403 && (error.code === 'forbidden' || error.code === 'viewer')) {
        setReadOnly(true);
        setPhase('ready');
        return;
      }
      setPhase('error');
    }
  }, [client, propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase === 'loading' || phase === 'error') {
    return (
      <View style={styles.pad}>
        <ScreenState phase={phase} contextLabel={COPY['property.loadingContext']} onRetry={() => void load()} />
      </View>
    );
  }

  if (phase === 'notFound') {
    return (
      <View style={styles.pad}>
        <Text accessibilityRole="alert">{copyText('common.notFound')}</Text>
        <PrimaryButton label={COPY['property.back']} onPress={onBack} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <PrimaryButton label={COPY['property.back']} onPress={onBack} />
      <Text accessibilityRole="header" style={styles.title}>
        {property?.name}
      </Text>
      {property ? <Text>{optionLabel(PROPERTY_TYPE_OPTIONS, property.propertyType)}</Text> : null}
      {property?.city ? <Text>{property.city}</Text> : null}
      {readOnly ? <Text accessibilityRole="text">{copyText('access.readonly')}</Text> : null}
      <Text style={styles.section}>{COPY['property.obligations']}</Text>
      {obligations.length === 0 ? <Text>{COPY['obligation.empty']}</Text> : null}
      {obligations.map((obligation) => (
        <View key={obligation.id} style={styles.card}>
          <Text style={styles.name}>{obligation.title}</Text>
          <Text>{optionLabel(CATEGORY_OPTIONS, obligation.category)}</Text>
          {obligation.nextDueDate ? <Text>{obligation.nextDueDate}</Text> : null}
          {amountLabel(obligation.expectedAmount)}
        </View>
      ))}
      {readOnly ? null : (
        <PrimaryButton label={COPY['obligation.add.short']} onPress={onAddObligation} testID="obligation-add" />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: {
    gap: 12,
    padding: 24,
  },
  title: {
    color: '#14221E',
    fontSize: 28,
    fontWeight: '700',
  },
  section: {
    color: '#14221E',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    gap: 4,
    padding: 16,
  },
  name: {
    color: '#14221E',
    fontSize: 18,
    fontWeight: '700',
  },
});
