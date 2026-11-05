import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import type { ApiClient } from '../api/client';
import { ApiClientError } from '../api/errors';
import type { ObligationCategory, ObligationWriteBody } from '../api/contract';
import { COPY, copyText, type CopyKey } from '../copy/userFacing';
import { buildObligationWrite, suggestedNextDueDate, type ObligationDraft } from './buildObligationWrite';
import { ChoiceRow, FormNotice, LabeledInput, PrimaryButton } from './fields';
import { isHeldWrite, sameWriteBody } from './heldWrite';
import { formatEsMxDate } from '../dates/nextDueDate';
import { FIELD_LIMITS } from './fieldLimits';
import { CATEGORY_OPTIONS, RECURRENCE_OPTIONS, optionLabel } from './labels';

function initialDraft(now: Date, timeZone: string): ObligationDraft {
  return {
    category: 'electricity',
    title: '',
    providerName: '',
    recurrence: 'monthly',
    nextDueDate: suggestedNextDueDate(now, timeZone),
    expectedAmount: '',
    notes: '',
  };
}

/**
 * Add-obligation form. Reintentar after idempotency_in_progress resends the
 * body captured on the first tap, including nextDueDate. Fields stay put.
 */
export function ObligationFormScreen({
  client,
  propertyId,
  timeZone = 'America/Mexico_City',
  now = () => new Date(),
  onCreated,
  onCancel,
}: {
  client: ApiClient;
  propertyId: string;
  timeZone?: string;
  now?: () => Date;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => initialDraft(now(), timeZone));
  const [notice, setNotice] = useState<CopyKey | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingBody = useRef<ObligationWriteBody | null>(null);
  const builtNow = buildObligationWrite(draft, now(), timeZone);
  const held =
    notice === 'common.connecting.failed' &&
    !!pendingBody.current &&
    builtNow.ok &&
    sameWriteBody(pendingBody.current, builtNow.body);

  function patch(partial: Partial<ObligationDraft>) {
    setDraft((current) => ({ ...current, ...partial }));
  }

  async function submit(mode: 'send' | 'retry') {
    if (busy) {
      return;
    }
    const built = buildObligationWrite(draft, now(), timeZone);
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
      await client.createObligation(propertyId, body);
      pendingBody.current = null;
      onCreated();
    } catch (error) {
      if (isHeldWrite(error)) {
        setNotice('common.connecting.failed');
        return;
      }
      if (error instanceof ApiClientError && error.copyKey === 'pay.sync.conflict') {
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

  const actionLabel = busy ? COPY['common.connecting'] : held ? COPY['common.retry'] : COPY['obligation.add.cta'];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>
        {COPY['obligation.add.title']}
      </Text>
      <FormNotice copyKey={notice} />
      <ChoiceRow
        label={COPY['obligation.category.label']}
        options={CATEGORY_OPTIONS.map((option) => ({
          value: option.value,
          label: optionLabel(CATEGORY_OPTIONS, option.value),
        }))}
        selected={draft.category}
        onSelect={(category: ObligationCategory) => patch({ category })}
      />
      <LabeledInput
        label={COPY['obligation.title.label']}
        testID="obligation-title-input"
        value={draft.title}
        maxLength={FIELD_LIMITS.obligationTitle}
        onChangeText={(title) => patch({ title })}
      />
      <LabeledInput
        label={COPY['obligation.provider.label']}
        testID="obligation-provider-input"
        value={draft.providerName}
        maxLength={FIELD_LIMITS.providerName}
        onChangeText={(providerName) => patch({ providerName })}
      />
      <ChoiceRow
        label={COPY['obligation.recurrence.label']}
        options={RECURRENCE_OPTIONS.map((option) => ({
          value: option.value,
          label: optionLabel(RECURRENCE_OPTIONS, option.value),
        }))}
        selected={draft.recurrence}
        onSelect={(recurrence) => patch({ recurrence })}
      />
      <Text testID="obligation-next-due" accessibilityLabel={COPY['obligation.nextDueDate.label']}>
        {`${COPY['obligation.nextDueDate.label']}: ${formatEsMxDate(draft.nextDueDate)}`}
      </Text>
      <LabeledInput
        label={COPY['obligation.amount.label']}
        testID="obligation-amount-input"
        value={draft.expectedAmount}
        onChangeText={(expectedAmount) => patch({ expectedAmount })}
      />
      <LabeledInput
        label={COPY['obligation.notes.label']}
        testID="obligation-notes-input"
        value={draft.notes}
        onChangeText={(notes) => patch({ notes })}
        multiline
      />
      <PrimaryButton
        label={actionLabel}
        disabled={busy}
        testID="obligation-save"
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
