import {
  OCR_REPLACE_BUTTON_LABEL,
  OCR_REPLACE_KEEP_LABEL,
  OCR_REPLACE_TOAST,
  OCR_UNREVIEWED_DISCARD_COPY,
  copyText,
  ocrReplacePrompt,
  type CopyKey,
} from '../copy/userFacing';
import { validateOcrEditValue } from './ocrEditValue';

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
  /**
   * Persisted server value. Null and undefined mean the field is not saved.
   * PR #3 readSaved treats only a non-null value as present.
   */
  savedValue?: string | null;
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
  /** Sent for `edit`, and for `replace` when the person supplies a new value. */
  editedValue?: string;
  /** Sent only for an unbound row. */
  targetEntityId?: string;
};

/** @deprecated Use OcrUiDecision. Kept as the local name. */
export type OcrClientDecision = OcrUiDecision;

/**
 * Confirm request item. Backend PR #3 is the source of truth.
 * `action` is accept, reject, edit, or replace. `decision`, `field`, and
 * `suggestedValue` are not sent. `editedValue` is sent for edit, and for replace
 * when the new value is not the stored suggestion. `targetEntityId` is sent for
 * an unbound row and omitted when the row is bound. `clientPriorValue` is never sent.
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
  /** Set when the field is already saved and accept or edit must not be sent. */
  blockedMessage?: string | null;
  /** AC-OCR-12. Only Mantener and Reemplazar. Present when the field already has a value. */
  offerReplace?: OcrReplaceRowModel | null;
};

export type EditFieldResult<T extends Record<string, string>> = {
  form: T;
  previousValue: string;
  decision: OcrUiDecision | null;
  error: { key: CopyKey; message: string } | null;
  /** Safety net when a saved field is edited without the Reemplazar tap. Key `ocr.field.saved`. */
  blockedMessage?: string | null;
  /** AC-OCR-12. Only Mantener and Reemplazar. */
  offerReplace?: OcrReplaceRowModel | null;
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

type FieldOptions = {
  targetEntityId?: string;
  now?: Date;
  timeZone?: string;
  /**
   * Local undo only. Mantener after Reemplazar writes this back.
   * A saved field uses `savedValue` instead. Never sent on the confirm request.
   */
  previousValue?: string;
};

/** Row id the screen scrolls into view when this suggestion blocks confirm. */
export function ocrSuggestionScrollTarget(suggestionId: string): string {
  return `ocr-suggestion-${suggestionId}`;
}

export type OcrTargetRequiredBlock = {
  suggestionId: string;
  field: string;
  key: 'ocr.target.required';
  message: string;
  scrollIntoView: true;
  scrollTargetId: string;
};

export function suggestOcrField(
  field: string,
  value: string,
  confidence?: number | null,
  extras?: {
    suggestionId?: string;
    band?: string | null;
    targetEntityId?: string;
    bound?: boolean;
    savedValue?: string | null;
  },
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
    savedValue: extras?.savedValue,
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
 * Empty unsaved field: confirm as `accept` and fill the form.
 * A field that already has a typed value, and a field that is already saved,
 * do not emit `replace`. They offer the AC-OCR-12 row (Mantener / Reemplazar).
 * A saved field also sets `ocr.field.saved` and leaves the form unchanged.
 * `replace` comes only from `tapReemplazar`.
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
  if (fieldIsSaved(suggestion)) {
    return savedFieldHold(unchanged, suggestion, previousValue);
  }
  if (!isEmpty(previousValue)) {
    return {
      ...unchanged,
      offerReplace: replaceSuggestionRow(previousValue, suggestion.value),
    };
  }
  const decision = clientDecision(suggestion, field, 'accepted', options);
  if (!decision) {
    return unchanged;
  }
  return {
    form: { ...form, [field]: suggestion.value },
    previousValue,
    decision,
    toast: null,
  };
}

/**
 * The Reemplazar tap. This is the only path that sets action `replace`.
 * It writes the suggested value and returns the previous value for a local undo.
 * The wire does not include `editedValue` or the unsaved typed text.
 * A saved field can be replaced from this tap.
 */
export function tapReemplazar<T extends Record<string, string>>(
  form: T,
  suggestion: OcrSuggestion,
  field: string,
  options?: FieldOptions,
): ReplaceFieldResult<T> {
  const previousValue = isApplyableField(form, field) ? (form[field] ?? '') : '';
  const unchanged: ReplaceFieldResult<T> = { form, previousValue, decision: null, toast: null };
  if (!suggestion.confirmed || suggestion.field !== field || !isApplyableField(form, field) || isEmpty(suggestion.value)) {
    return unchanged;
  }
  const decision = clientDecision(suggestion, field, 'replaced', options);
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
  const validated = validateOcrEditValue(field, editedValue, {
    now: options?.now,
    timeZone: options?.timeZone,
  });
  if (!validated.ok) {
    return unchanged({ key: validated.key, message: validated.message });
  }
  if (fieldIsSaved(suggestion)) {
    const held = savedFieldHold({ form, previousValue, decision: null, toast: null }, suggestion, previousValue);
    return {
      form,
      previousValue,
      decision: null,
      error: { key: 'ocr.field.saved', message: held.blockedMessage ?? copyText('ocr.field.saved') },
      blockedMessage: held.blockedMessage,
      offerReplace: held.offerReplace,
    };
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

/**
 * "Mantener lo que escribí". The confirm action is `reject`.
 * After Reemplazar, pass the tap's `previousValue` so the form returns to the
 * text from before that tap. A saved field returns to `savedValue`.
 * That text stays off the confirm request.
 */
export function keepTypedField<T extends Record<string, string>>(
  form: T,
  suggestion: OcrSuggestion,
  field: string,
  options?: FieldOptions,
): { form: T; decision: OcrUiDecision | null } {
  if (!isApplyableField(form, field) || suggestion.field !== field) {
    return { form, decision: null };
  }
  const decision = clientDecision(suggestion, field, 'kept', options);
  if (!decision) {
    return { form, decision: null };
  }
  const restore = valueAfterKeep(suggestion, options?.previousValue);
  if (restore === undefined || (form[field] ?? '') === restore) {
    return { form, decision };
  }
  return { form: { ...form, [field]: restore }, decision };
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
 * AC-OCR-12. A field that already has a value offers only
 * "Mantener lo que escribí" (default, highlighted) and "Reemplazar".
 * It never offers Aceptar or Editar. An empty field has no replace row.
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

/** Maps a local choice onto one confirm decision. Never emits decision, field, suggestedValue, or a typed-value key. */
export function ocrDecisionForServer(decision: OcrUiDecision): OcrWireDecision {
  const action = WIRE_ACTION[decision.ui];
  const payload: OcrWireDecision = {
    suggestionId: decision.suggestionId,
    action,
  };
  if ((action === 'edit' || action === 'replace') && typeof decision.editedValue === 'string') {
    payload.editedValue = decision.editedValue;
  }
  if (decision.targetEntityId) {
    payload.targetEntityId = decision.targetEntityId;
  }
  return payload;
}

export type DiscardUnreviewedResult<T extends Record<string, string>> = {
  form: T;
  discarded: OcrSuggestion[];
  notice: string | null;
};

export type ConfirmOnRegistrarResult<T extends Record<string, string>> = DiscardUnreviewedResult<T> & {
  payload: OcrWireDecision[];
  /** Null when sending the body would be a saved-field accept/edit or a row with no target. */
  request: OcrConfirmRequest | null;
  blockedSaved: OcrSuggestion[];
  /** Unbound non-reject rows that have no target. Confirm scrolls the first of these into view. */
  targetErrors: OcrTargetRequiredBlock[];
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
    reviewedById.set(decision.suggestionId, decision);
  }
  const seen = new Set<string>();
  const payload: OcrWireDecision[] = [];
  const discarded: OcrSuggestion[] = [];
  const blockedSaved: OcrSuggestion[] = [];
  const targetErrors: OcrTargetRequiredBlock[] = [];
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
    const wire = wireForSuggestion(suggestion, ocrDecisionForServer(choice));
    if (fieldIsSaved(suggestion) && (wire.action === 'accept' || wire.action === 'edit')) {
      blockedSaved.push(suggestion);
      continue;
    }
    if (wire.action !== 'reject' && !suggestion.bound && !wire.targetEntityId && suggestion.suggestionId) {
      targetErrors.push({
        suggestionId: suggestion.suggestionId,
        field: suggestion.field,
        key: 'ocr.target.required',
        message: copyText('ocr.target.required'),
        scrollIntoView: true,
        scrollTargetId: ocrSuggestionScrollTarget(suggestion.suggestionId),
      });
    }
    payload.push(wire);
  }
  const notice = discarded.length > 0 ? OCR_UNREVIEWED_DISCARD_COPY : null;
  if (blockedSaved.length > 0 || targetErrors.length > 0) {
    return { form, discarded, payload: [], request: null, blockedSaved, targetErrors, notice };
  }
  const request = buildConfirmRequest(payload);
  return {
    form,
    discarded,
    payload: request.decisions,
    request,
    blockedSaved,
    targetErrors,
    notice,
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
  return JSON.stringify(stripClientPriorValue(buildConfirmRequest(payload)));
}

/** Drops `clientPriorValue` at every object level. Other keys are kept. */
export function stripClientPriorValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripClientPriorValue(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'clientPriorValue') {
      continue;
    }
    out[key] = stripClientPriorValue(entry);
  }
  return out;
}

/**
 * PR #3 confirm response. `persisted` is true only when the save writes commit.
 */
export function readOcrConfirmResult(body: unknown): { persisted: boolean } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  const persisted = (body as { persisted?: unknown }).persisted;
  if (typeof persisted !== 'boolean') {
    return null;
  }
  return { persisted };
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
  if ((decision.action === 'edit' || decision.action === 'replace') && typeof decision.editedValue === 'string') {
    payload.editedValue = decision.editedValue;
  }
  if (typeof decision.targetEntityId === 'string' && decision.targetEntityId !== '') {
    payload.targetEntityId = decision.targetEntityId;
  }
  return payload;
}

function valueAfterKeep(suggestion: OcrSuggestion, previousValue: string | undefined): string | undefined {
  if (previousValue === undefined) {
    return undefined;
  }
  if (fieldIsSaved(suggestion) && typeof suggestion.savedValue === 'string') {
    return suggestion.savedValue;
  }
  return previousValue;
}

function savedFieldHold<T extends Record<string, string>>(
  unchanged: ReplaceFieldResult<T>,
  suggestion: OcrSuggestion,
  previousValue: string,
): ReplaceFieldResult<T> {
  const savedText = typeof suggestion.savedValue === 'string' ? suggestion.savedValue : '';
  const actual = !isEmpty(savedText) ? savedText : previousValue;
  return {
    ...unchanged,
    blockedMessage: copyText('ocr.field.saved'),
    offerReplace: replaceSuggestionRow(actual, suggestion.value),
  };
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

function fieldIsSaved(suggestion: OcrSuggestion): boolean {
  return suggestion.savedValue !== undefined && suggestion.savedValue !== null;
}

function isApplyableField(form: Record<string, string>, field: string): boolean {
  if (field === '__proto__' || field === 'constructor' || field === 'prototype') {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(form, field);
}
