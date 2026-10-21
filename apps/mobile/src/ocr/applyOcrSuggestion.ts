export type OcrSuggestion = {
  field: string;
  value: string;
  /** Starts false. applyOcrSuggestion writes only after an explicit confirm. */
  confirmed: boolean;
  confidence?: number | null;
};

export function suggestOcrField(
  field: string,
  value: string,
  confidence?: number | null,
): OcrSuggestion {
  return { field, value, confirmed: false, confidence };
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
 * including suggestions that were already confirmed. There is no bulk accept.
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

function isApplyableField(form: Record<string, string>, field: string): boolean {
  if (field === '__proto__' || field === 'constructor' || field === 'prototype') {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(form, field);
}
