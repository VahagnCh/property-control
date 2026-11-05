import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import type { ApiClient } from '../api/client';
import { ApiClientError } from '../api/errors';
import type { PropertyWriteBody } from '../api/contract';
import { COPY, copyText, type CopyKey } from '../copy/userFacing';
import { buildPropertyWrite, type PropertyDraft } from './buildPropertyWrite';
import { ChoiceRow, FormNotice, LabeledInput, PrimaryButton } from './fields';
import { isHeldWrite, sameWriteBody } from './heldWrite';
import { FIELD_LIMITS } from './fieldLimits';
import { OCCUPANCY_OPTIONS, PROPERTY_TYPE_OPTIONS, optionLabel } from './labels';

const INITIAL: PropertyDraft = {
  name: '',
  propertyType: 'house',
  occupancyStatus: 'owned',
  addressLine: '',
  city: '',
  state: '',
};

/**
 * Add-property form. A 409 idempotency_in_progress keeps every field and the
 * original body. Reintentar sends that same body. There is no failure toast.
 */
export function PropertyFormScreen({
  client,
  onCreated,
  onCancel,
}: {
  client: ApiClient;
  onCreated: (propertyId: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<PropertyDraft>(INITIAL);
  const [notice, setNotice] = useState<CopyKey | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingBody = useRef<PropertyWriteBody | null>(null);
  const builtNow = buildPropertyWrite(draft);
  const held =
    notice === 'common.connecting.failed' &&
    !!pendingBody.current &&
    builtNow.ok &&
    sameWriteBody(pendingBody.current, builtNow.body);

  function patch(partial: Partial<PropertyDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  async function submit(mode: 'send' | 'retry') {
    if (busy) {
      return;
    }
    const built = buildPropertyWrite(draft);
    if (!built.ok) {
      setNotice(built.key);
      return;
    }
    const reuse = mode === 'retry' && pendingBody.current && sameWriteBody(pendingBody.current, built.body);
    const body = reuse && pendingBody.current ? pendingBody.current : built.body;
    pendingBody.current = body;
    setBusy(true);
    setNotice(null);
    try {
      const created = await client.createProperty(body);
      pendingBody.current = null;
      onCreated(created.id);
    } catch (error) {
      if (isHeldWrite(error)) {
        setNotice('common.connecting.failed');
        return;
      }
      if (error instanceof ApiClientError && (error.copyKey === 'pay.sync.conflict' || error.status === 409)) {
        pendingBody.current = null;
        setNotice('pay.sync.conflict');
        return;
      }
      const key = error instanceof ApiClientError ? error.copyKey : 'err.generic';
      setNotice(key);
    } finally {
      setBusy(false);
    }
  }

  const actionLabel = busy ? COPY['common.connecting'] : held ? COPY['common.retry'] : COPY['property.add.cta'];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>
        {COPY['property.add.title']}
      </Text>
      <FormNotice copyKey={notice} />
      <LabeledInput
        label={COPY['property.name.label']}
        testID="property-name-input"
        value={draft.name}
        maxLength={FIELD_LIMITS.propertyName}
        onChangeText={(name) => patch({ name })}
      />
      <ChoiceRow
        label={COPY['property.type.label']}
        options={PROPERTY_TYPE_OPTIONS.map((option) => ({ value: option.value, label: optionLabel(PROPERTY_TYPE_OPTIONS, option.value) }))}
        selected={draft.propertyType}
        onSelect={(propertyType) => patch({ propertyType })}
      />
      <LabeledInput
        label={COPY['property.address.label']}
        testID="property-address-input"
        value={draft.addressLine}
        maxLength={FIELD_LIMITS.addressLine}
        onChangeText={(addressLine) => patch({ addressLine })}
      />
      <LabeledInput
        label={COPY['property.city.label']}
        testID="property-city-input"
        value={draft.city}
        maxLength={FIELD_LIMITS.city}
        onChangeText={(city) => patch({ city })}
      />
      <LabeledInput
        label={COPY['property.state.label']}
        testID="property-state-input"
        value={draft.state}
        maxLength={FIELD_LIMITS.state}
        onChangeText={(state) => patch({ state })}
      />
      <ChoiceRow
        label={COPY['property.occupancy.label']}
        options={OCCUPANCY_OPTIONS.map((option) => ({ value: option.value, label: optionLabel(OCCUPANCY_OPTIONS, option.value) }))}
        selected={draft.occupancyStatus}
        onSelect={(occupancyStatus) => patch({ occupancyStatus })}
      />
      <PrimaryButton
        label={actionLabel}
        disabled={busy}
        testID="property-save"
        onPress={() => {
          void submit(held ? 'retry' : 'send');
        }}
      />
      <PrimaryButton label={copyText('property.back')} onPress={onCancel} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    padding: 24,
  },
  title: {
    color: '#14221E',
    fontSize: 28,
    fontWeight: '700',
  },
});
