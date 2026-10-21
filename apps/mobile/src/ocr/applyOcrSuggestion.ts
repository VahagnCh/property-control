import {
  OCR_REPLACE_BUTTON_LABEL,
  OCR_REPLACE_KEEP_LABEL,
  OCR_REPLACE_TOAST,
  OCR_UNREVIEWED_DISCARD_COPY,
  ocrReplacePrompt,
} from '../copy/userFacing';

export type OcrSuggestion = {
  suggestionId?: string;
  field: string;
  value: string;
  /** Starts false. A write happens only after an explicit confirm. */
  confirmed: boolean;
  confidence?: number | null;
  band?: string | null;
};

/**
 * Decision the client can send before Registrar. There is no API call here.
 *
 * B17 is confirmed. The payload is only
 * { suggestionId, field, decision: 'replaced' | 'kept' | 'rejected', suggestedValue }.
 * The audit covers saved state only. This payload never includes the unsaved
 * typed value. The API returns 422 for any typed value. For a record that is
 * already saved, the server logs the persisted previous value itself, so the
 * client sends nothing extra. `previousValue` on the local replace result is
 * for undo in the UI only and must not be copied onto this payload.
 */
export type OcrClientDecision = {
  suggestionId: string;
  field: string;
  decision: 'replaced' | 'kept' | 'rejected';
  suggestedValue: string;
};

export type ReplaceFieldResult<T extends Record<string, string>> = {
  form: T;
  /** Local undo only. Not part of the server decision. */
  previousValue: string;
  decision: OcrClientDecision | null;
  toast: string | null;
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

export function suggestOcrField(
  field: string,
  value: string,
  confidence?: number | null,
  extras?: { suggestionId?: string; band?: string | null },
): OcrSuggestion {
  return {
    suggestionId: extras?.suggestionId,
    field,
    value,
    confirmed: false,
    confidence,
    band: extras?.band,
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
 * then, and returns the previous value for a local undo. The decision
 * record never carries that previous value.
 */
export function replaceField<T extends Record<string, string>>(
  form: T,
  suggestion: OcrSuggestion,
  field: string,
): ReplaceFieldResult<T> {
  const previousValue = isApplyableField(form, field) ? (form[field] ?? '') : '';
  const unchanged: ReplaceFieldResult<T> = { form, previousValue, decision: null, toast: null };
  if (!suggestion.confirmed) {
    return unchanged;
  }
  if (suggestion.field !== field || !isApplyableField(form, field) || isEmpty(suggestion.value)) {
    return unchanged;
  }
  const decision = clientDecision(suggestion, field, 'replaced');
  if (!decision) {
    return unchanged;
  }
  return {
    form: { ...form, [field]: suggestion.value },
    previousValue,
    decision,
    toast: OCR_REPLACE_TOAST,
  };
}

/** "Mantener lo que escribí". The typed value stays. */
export function keepTypedField<T extends Record<string, string>>(
  form: T,
  suggestion: OcrSuggestion,
  field: string,
): { form: T; decision: OcrClientDecision | null } {
  if (!isApplyableField(form, field) || suggestion.field !== field) {
    return { form, decision: null };
  }
  return { form, decision: clientDecision(suggestion, field, 'kept') };
}

/** Rechazar. The typed value stays, including when the suggestion was confirmed. */
export function rejectOcrField<T extends Record<string, string>>(
  form: T,
  suggestion: OcrSuggestion,
  field: string,
): { form: T; decision: OcrClientDecision | null } {
  if (!isApplyableField(form, field) || suggestion.field !== field) {
    return { form, decision: null };
  }
  return { form, decision: clientDecision(suggestion, field, 'rejected') };
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

const DECISION_KEYS = ['suggestionId', 'field', 'decision', 'suggestedValue'] as const;

/** Drops every key that is not part of the before-Registrar decision. */
export function ocrDecisionForServer(decision: OcrClientDecision): OcrClientDecision {
  return {
    suggestionId: decision.suggestionId,
    field: decision.field,
    decision: decision.decision,
    suggestedValue: decision.suggestedValue,
  };
}

export type OcrDecisionWire =
  | { ok: true; payload: OcrClientDecision }
  | { ok: false; status: 422; reason: 'typed_value' };

/**
 * B17. A body that carries a typed value is the 422 the API returns.
 * The success payload is only the four confirmed fields.
 */
export function prepareOcrDecision(
  decision: OcrClientDecision & Record<string, unknown>,
  unsavedTypedValue: string,
): OcrDecisionWire {
  if (decisionCarriesTypedValue(decision, unsavedTypedValue)) {
    return { ok: false, status: 422, reason: 'typed_value' };
  }
  return { ok: true, payload: ocrDecisionForServer(decision) };
}

/** B17 decision route. A 422 means the body included a typed value. */
export function mapOcrDecisionRouteStatus(status: number): { status: 422; reason: 'typed_value' } | null {
  if (status !== 422) {
    return null;
  }
  return { status: 422, reason: 'typed_value' };
}

export type DiscardUnreviewedResult<T extends Record<string, string>> = {
  form: T;
  discarded: OcrSuggestion[];
  notice: string | null;
};

/**
 * On Registrar, a suggestion with no per-field decision is discarded.
 * Discarding never writes the form, including when the suggestion is confirmed.
 */
export function discardUnreviewedSuggestions<T extends Record<string, string>>(
  form: T,
  suggestions: readonly OcrSuggestion[],
  decisions: readonly OcrClientDecision[],
): DiscardUnreviewedResult<T> {
  const reviewed = new Set(decisions.map((decision) => decision.suggestionId));
  const discarded = suggestions.filter(
    (suggestion) => suggestion.suggestionId == null || !reviewed.has(suggestion.suggestionId),
  );
  return {
    form,
    discarded,
    notice: discarded.length > 0 ? OCR_UNREVIEWED_DISCARD_COPY : null,
  };
}

function decisionCarriesTypedValue(
  decision: OcrClientDecision & Record<string, unknown>,
  unsavedTypedValue: string,
): boolean {
  for (const key of Object.keys(decision)) {
    if (!DECISION_KEYS.includes(key as (typeof DECISION_KEYS)[number])) {
      return true;
    }
  }
  if (unsavedTypedValue === '') {
    return false;
  }
  for (const key of DECISION_KEYS) {
    if (key === 'suggestedValue') {
      continue;
    }
    if (decision[key] === unsavedTypedValue) {
      return true;
    }
  }
  return false;
}

export function serializeOcrDecision(decision: OcrClientDecision): string {
  return JSON.stringify(ocrDecisionForServer(decision));
}

function clientDecision(
  suggestion: OcrSuggestion,
  field: string,
  decision: OcrClientDecision['decision'],
): OcrClientDecision | null {
  if (!suggestion.suggestionId || suggestion.field !== field) {
    return null;
  }
  return {
    suggestionId: suggestion.suggestionId,
    field,
    decision,
    suggestedValue: suggestion.value,
  };
}

function isApplyableField(form: Record<string, string>, field: string): boolean {
  if (field === '__proto__' || field === 'constructor' || field === 'prototype') {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(form, field);
}
