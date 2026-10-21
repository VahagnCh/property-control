import {
  OCR_REPLACE_BUTTON_LABEL,
  OCR_REPLACE_KEEP_LABEL,
  OCR_REPLACE_TOAST,
  OCR_UNREVIEWED_DISCARD_COPY,
  ocrReplacePrompt,
  type CopyKey,
} from '../copy/userFacing';
import { validateTextInput, type TextField } from '../forms/textInput';

export type OcrSuggestion = {
  suggestionId?: string;
  field: string;
  value: string;
  /** Starts false. A write happens only after an explicit confirm. */
  confirmed: boolean;
  confidence?: number | null;
  band?: string | null;
  /**
   * Server id when the row is already bound. Sent only for an unbound row.
   * A bound row never puts this id on the confirm request.
   */
  targetEntityId?: string;
  /** True when the server already bound the row. The id is not sent. */
  bound?: boolean;
};

/**
 * Local choice. These names stay in the UI and are never the confirm wire value.
 * `accepted` is a confirm into an empty field. `replaced` is Reemplazar.
 * `edited` is a correction of the suggested value. `kept` is Mantener.
 * `rejected` is Rechazar.
 */
export type OcrUiChoice = 'accepted' | 'replaced' | 'edited' | 'kept' | 'rejected';

export type OcrUiDecision = {
  suggestionId: string;
  field: string;
  ui: OcrUiChoice;
  /** Local only. The confirm request does not send this. */
  suggestedValue?: string;
  /** Sent only when `ui` is `edited`. */
  editedValue?: string;
  /** Sent only for an unbound row. */
  targetEntityId?: string;
};

/** @deprecated Use OcrUiDecision. Kept as the local name. */
export type OcrClientDecision = OcrUiDecision;

/**
 * Confirm request item. Backend PR #3 is the source of truth.
 * `action` is accept, reject, edit, or replace. `decision`, `field`, and
 * `suggestedValue` are not sent. `editedValue` is sent only for edit.
 * `targetEntityId` is sent only for an unbound row. `clientPriorValue` is never sent.
 */
export type OcrWireAction = 'accept' | 'reject' | 'edit' | 'replace';

export type OcrWireDecision = {
  suggestionId: string;
  action: OcrWireAction;
  editedValue?: string;
  targetEntityId?: string;
};

export type OcrConfirmRequest = {
  decisions: OcrWireDecision[];
};

export type ReplaceFieldResult<T extends Record<string, string>> = {
  form: T;
  /** Local undo only. Not part of the confirm request. */
  previousValue: string;
  decision: OcrUiDecision | null;
  toast: string | null;
};

export type EditFieldResult<T extends Record<string, string>> = {
  form: T;
  previousValue: string;
  decision: OcrUiDecision | null;
  error: { key: CopyKey; message: string } | null;
};

export type OcrReplaceAction = {
  decision: 'kept' | 'replaced';
  label: string;
  highlighted: boolean;
  isDefault: boolean;
};

export type OcrReplaceRowModel = {
  prompt: string;
  actions: readonly [OcrReplaceAction, OcrReplaceAction];
  toast: string;
};

type FieldOptions = { targetEntityId?: string };

export function suggestOcrField(
  field: string,
  value: string,
  confidence?: number | null,
  extras?: { suggestionId?: string; band?: string | null; targetEntityId?: string; bound?: boolean },
): OcrSuggestion {
  return {
    suggestionId: extras?.suggestionId,
    field,
    value,
    confirmed: false,
    confidence,
    band: extras?.band,
    targetEntityId: extras?.targetEntityId,
    bound: extras?.bound,
  };
}

export function confirmOcrSuggestion(suggestion: OcrSuggestion): OcrSuggestion {
  return { ...suggestion, confirmed: true };
}

function isEmpty(value: string): boolean {
  return value.trim() === '';
}

/**
 * Fills one field that already exists on the form and is empty.
 * Does not add keys, does not overwrite a user-entered value, and does
 * nothing unless the suggestion was explicitly confirmed.
 */
export function applyOcrSuggestion<T extends Record<string, string>>(
  form: T,
  suggestion: OcrSuggestion,
): T {
  if (!suggestion.confirmed) {
    return form;
  }
  if (!isApplyableField(form, suggestion.field)) {
    return form;
  }
  if (!isEmpty(form[suggestion.field] ?? '')) {
    return form;
  }
  if (isEmpty(suggestion.value)) {
    return form;
  }
  return { ...form, [suggestion.field]: suggestion.value };
}

/**
 * Applies each confirmed suggestion. `acceptAll: true` applies nothing,
 * including suggestions that were already confirmed. There is no bulk accept
 * and no bulk replace.
 */
export function applyOcrSuggestions<T extends Record<string, string>>(
  form: T,
  suggestions: readonly OcrSuggestion[],
  options?: { acceptAll?: boolean },
): T {
  if (options?.acceptAll) {
    return form;
  }
  return suggestions.reduce((next, suggestion) => applyOcrSuggestion(next, suggestion), form);
}

/**
 * One field. Requires an explicit confirm. Overwrites a typed value only
 * then, and returns the previous value for a local undo. The confirm request
 * does not carry that previous value.
 */
export function replaceField<T extends Record<string, string>>(
  form: T,
  suggestion: OcrSuggestion,
  field: string,
  options?: FieldOptions,
): ReplaceFieldResult<T> {
  const previousValue = isApplyableField(form, field) ? (form[field] ?? '') : '';
  const unchanged: ReplaceFieldResult<T> = { form, previousValue, decision: null, toast: null };
  if (!suggestion.confirmed) {
    return unchanged;
  }
  if (suggestion.field !== field || !isApplyableField(form, field) || isEmpty(suggestion.value)) {
    return unchanged;
  }
  const ui: OcrUiChoice = isEmpty(previousValue) ? 'accepted' : 'replaced';
  const decision = clientDecision(suggestion, field, ui, options);
  if (!decision) {
    return unchanged;
  }
  return {
    form: { ...form, [field]: suggestion.value },
    previousValue,
    decision,
    toast: ui === 'replaced' ? OCR_REPLACE_TOAST : null,
  };
}

/**
 * A correction of the suggested value before Registrar. The wire action is
 * `edit` and the only text sent is `editedValue`, after the same text rules
 * as the form. A failure leaves the form unchanged and does not strip the text.
 */
export function editOcrField<T extends Record<string, string>>(
  form: T,
  suggestion: OcrSuggestion,
  field: string,
  editedValue: string,
  options?: FieldOptions,
): EditFieldResult<T> {
  const previousValue = isApplyableField(form, field) ? (form[field] ?? '') : '';
  const unchanged = (error: EditFieldResult<T>['error']): EditFieldResult<T> => ({
    form,
    previousValue,
    decision: null,
    error,
  });
  if (!suggestion.confirmed || suggestion.field !== field || !isApplyableField(form, field)) {
    return unchanged(null);
  }
  if (!suggestion.suggestionId) {
    return unchanged(null);
  }
  const validated = validateTextInput(editedValue, textFieldFor(field));
  if (!validated.ok) {
    return unchanged({ key: validated.key, message: validated.message });
  }
  const decision = clientDecision(suggestion, field, 'edited', options);
  if (!decision) {
    return unchanged(null);
  }
  decision.editedValue = validated.value;
  return {
    form: { ...form, [field]: validated.value },
    previousValue,
    decision,
    error: null,
  };
}

/** "Mantener lo que escribí". The typed value stays. */
export function keepTypedField<T extends Record<string, string>>(
  form: T,
  suggestion: OcrSuggestion,
  field: string,
  options?: FieldOptions,
): { form: T; decision: OcrUiDecision | null } {
  if (!isApplyableField(form, field) || suggestion.field !== field) {
    return { form, decision: null };
  }
  return { form, decision: clientDecision(suggestion, field, 'kept', options) };
}

/** Rechazar. The typed value stays, including when the suggestion was confirmed. */
export function rejectOcrField<T extends Record<string, string>>(
  form: T,
  suggestion: OcrSuggestion,
  field: string,
  options?: FieldOptions,
): { form: T; decision: OcrUiDecision | null } {
  if (!isApplyableField(form, field) || suggestion.field !== field) {
    return { form, decision: null };
  }
  return { form, decision: clientDecision(suggestion, field, 'rejected', options) };
}

/**
 * Row shown when the field already has a typed value.
 * "Mantener lo que escribí" is the default and the highlighted action.
 * An empty field has no replace row; it still fills only after confirm.
 */
export function replaceSuggestionRow(actual: string, suggested: string): OcrReplaceRowModel | null {
  if (isEmpty(actual)) {
    return null;
  }
  return {
    prompt: ocrReplacePrompt(actual, suggested),
    actions: [
      {
        decision: 'kept',
        label: OCR_REPLACE_KEEP_LABEL,
        highlighted: true,
        isDefault: true,
      },
      {
        decision: 'replaced',
        label: OCR_REPLACE_BUTTON_LABEL,
        highlighted: false,
        isDefault: false,
      },
    ],
    toast: OCR_REPLACE_TOAST,
  };
}

const WIRE_ACTION: Record<OcrUiChoice, OcrWireAction> = {
  accepted: 'accept',
  replaced: 'replace',
  edited: 'edit',
  kept: 'reject',
  rejected: 'reject',
};

const TYPED_VALUE_KEYS = new Set([
  'previousTypedValue',
  'typedValue',
  'previousValue',
  'persistedPreviousValue',
  'clientPriorValue',
  'actual',
]);

/** Maps a local choice onto one confirm decision. Never emits decision, field, or suggestedValue. */
export function ocrDecisionForServer(decision: OcrUiDecision): OcrWireDecision {
  const action = WIRE_ACTION[decision.ui];
  const payload: OcrWireDecision = {
    suggestionId: decision.suggestionId,
    action,
  };
  if (action === 'edit' && typeof decision.editedValue === 'string') {
    payload.editedValue = decision.editedValue;
  }
  if (decision.targetEntityId) {
    payload.targetEntityId = decision.targetEntityId;
  }
  return payload;
}

export type OcrDecisionWire =
  | { ok: true; payload: OcrWireDecision }
  | { ok: false; reason: 'typed_value' };

/**
 * Refuses a local record that carries a typed value or clientPriorValue.
 * The success payload is one confirm decision and nothing else.
 */
export function prepareOcrDecision(
  decision: OcrUiDecision & Record<string, unknown>,
  unsavedTypedValue: string,
): OcrDecisionWire {
  if (decisionCarriesTypedValue(decision, unsavedTypedValue)) {
    return { ok: false, reason: 'typed_value' };
  }
  return { ok: true, payload: ocrDecisionForServer(decision) };
}

export type DiscardUnreviewedResult<T extends Record<string, string>> = {
  form: T;
  discarded: OcrSuggestion[];
  notice: string | null;
};

export type ConfirmOnRegistrarResult<T extends Record<string, string>> = DiscardUnreviewedResult<T> & {
  payload: OcrWireDecision[];
  request: OcrConfirmRequest;
};

/**
 * Registrar. Every suggestion id is in the request exactly once.
 * An unreviewed suggestion is action 'reject' and does not write the form.
 * The notice copy still says those suggestions will be discarded.
 */
export function confirmOnRegistrar<T extends Record<string, string>>(
  form: T,
  suggestions: readonly OcrSuggestion[],
  reviewed: readonly OcrUiDecision[],
): ConfirmOnRegistrarResult<T> {
  const reviewedById = new Map<string, OcrUiDecision>();
  for (const decision of reviewed) {
    if (!reviewedById.has(decision.suggestionId)) {
      reviewedById.set(decision.suggestionId, decision);
    }
  }
  const seen = new Set<string>();
  const payload: OcrWireDecision[] = [];
  const discarded: OcrSuggestion[] = [];
  for (const suggestion of suggestions) {
    if (!suggestion.suggestionId || seen.has(suggestion.suggestionId)) {
      continue;
    }
    seen.add(suggestion.suggestionId);
    const choice = reviewedById.get(suggestion.suggestionId);
    if (!choice) {
      discarded.push(suggestion);
      payload.push(rejectWire(suggestion));
      continue;
    }
    payload.push(wireForSuggestion(suggestion, ocrDecisionForServer(choice)));
  }
  const request = buildConfirmRequest(payload);
  return {
    form,
    discarded,
    payload: request.decisions,
    request,
    notice: discarded.length > 0 ? OCR_UNREVIEWED_DISCARD_COPY : null,
  };
}

/**
 * On Registrar, a suggestion with no per-field choice is serialized as reject.
 * That does not write the form, including when the suggestion was confirmed.
 */
export function discardUnreviewedSuggestions<T extends Record<string, string>>(
  form: T,
  suggestions: readonly OcrSuggestion[],
  decisions: readonly OcrUiDecision[],
): ConfirmOnRegistrarResult<T> {
  return confirmOnRegistrar(form, suggestions, decisions);
}

export function buildConfirmRequest(payload: readonly OcrWireDecision[]): OcrConfirmRequest {
  return { decisions: payload.map((decision) => wireOnly(decision)) };
}

export function serializeOcrDecision(decision: OcrUiDecision): string {
  return JSON.stringify(ocrDecisionForServer(decision));
}

export function serializeConfirmPayload(payload: readonly OcrWireDecision[]): string {
  return JSON.stringify(buildConfirmRequest(payload));
}

function rejectWire(suggestion: OcrSuggestion): OcrWireDecision {
  return wireForSuggestion(suggestion, {
    suggestionId: suggestion.suggestionId ?? '',
    action: 'reject',
  });
}

function wireForSuggestion(suggestion: OcrSuggestion, decision: OcrWireDecision): OcrWireDecision {
  const payload = wireOnly(decision);
  if (suggestion.bound) {
    delete payload.targetEntityId;
    return payload;
  }
  if (!payload.targetEntityId && suggestion.targetEntityId) {
    payload.targetEntityId = suggestion.targetEntityId;
  }
  return payload;
}

function wireOnly(decision: OcrWireDecision): OcrWireDecision {
  const payload: OcrWireDecision = {
    suggestionId: decision.suggestionId,
    action: decision.action,
  };
  if (decision.action === 'edit' && typeof decision.editedValue === 'string') {
    payload.editedValue = decision.editedValue;
  }
  if (typeof decision.targetEntityId === 'string' && decision.targetEntityId !== '') {
    payload.targetEntityId = decision.targetEntityId;
  }
  return payload;
}

function decisionCarriesTypedValue(
  decision: OcrUiDecision & Record<string, unknown>,
  unsavedTypedValue: string,
): boolean {
  for (const key of Object.keys(decision)) {
    if (TYPED_VALUE_KEYS.has(key)) {
      return true;
    }
  }
  if (unsavedTypedValue === '') {
    return false;
  }
  if (decision.field === unsavedTypedValue || decision.suggestionId === unsavedTypedValue) {
    return true;
  }
  if (decision.targetEntityId === unsavedTypedValue) {
    return true;
  }
  return false;
}

function clientDecision(
  suggestion: OcrSuggestion,
  field: string,
  ui: OcrUiChoice,
  options?: FieldOptions,
): OcrUiDecision | null {
  if (!suggestion.suggestionId || suggestion.field !== field) {
    return null;
  }
  const decision: OcrUiDecision = {
    suggestionId: suggestion.suggestionId,
    field,
    ui,
  };
  if (!isEmpty(suggestion.value)) {
    decision.suggestedValue = suggestion.value;
  }
  if (!suggestion.bound) {
    const target = options?.targetEntityId ?? suggestion.targetEntityId;
    if (target) {
      decision.targetEntityId = target;
    }
  }
  return decision;
}

function textFieldFor(field: string): TextField {
  return field === 'note' || field === 'body' ? 'note' : 'title';
}

function isApplyableField(form: Record<string, string>, field: string): boolean {
  if (field === '__proto__' || field === 'constructor' || field === 'prototype') {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(form, field);
}
