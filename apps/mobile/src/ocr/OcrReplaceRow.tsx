import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  keepTypedField,
  replaceSuggestionRow,
  tapReemplazar,
  type OcrSuggestion,
  type OcrUiDecision,
  type ReplaceFieldResult,
} from './applyOcrSuggestion';

export type OcrReviewForm = Record<string, string>;

/** Undo map key. Suggestion id and field path, so two rows do not share one value. */
export function ocrReplaceUndoKey(suggestionId: string, field: string): string {
  return `${suggestionId}\0${field}`;
}

/**
 * AC-OCR-12. A suggestion row whose field already has a value offers only
 * "Mantener lo que escribí" (default, highlighted) and "Reemplazar".
 * The Reemplazar undo lives in this row's state, keyed by suggestion id and
 * field path, and is passed into `tapReemplazar`. Mantener clears that key.
 * A tap recaptures the field when it is not the suggestion, and keeps the
 * stored undo when the field already shows the suggestion. This does not call the API.
 */
export function OcrReplaceRow({
  actual,
  suggested,
  onKeep,
  onReplace,
  form,
  suggestion,
  field,
}: {
  actual: string;
  suggested: string;
  onKeep?: (result?: { form: OcrReviewForm; decision: OcrUiDecision | null }) => void;
  onReplace?: (result?: ReplaceFieldResult<OcrReviewForm>) => void;
  form?: OcrReviewForm;
  suggestion?: OcrSuggestion;
  field?: string;
}) {
  const [toast, setToast] = useState(false);
  const [undo, setUndo] = useState<Record<string, string>>({});
  const row = replaceSuggestionRow(actual, suggested);
  if (!row) {
    return null;
  }
  const suggestionId = suggestion?.suggestionId ?? '';
  const undoKey = field ? ocrReplaceUndoKey(suggestionId, field) : '';
  const storedUndo =
    undoKey !== '' && suggestionId !== '' && Object.prototype.hasOwnProperty.call(undo, undoKey)
      ? undo[undoKey]
      : undefined;
  const undoOptions = storedUndo !== undefined ? { previousValue: storedUndo } : undefined;
  const actions = row.actions.filter((action) => action.decision === 'kept' || action.decision === 'replaced');
  return (
    <View>
      <Text>{row.prompt}</Text>
      {actions.map((action) => (
        <Pressable
          key={action.decision}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ selected: action.highlighted }}
          onPress={() => {
            if (action.decision === 'kept') {
              if (form && suggestion && field) {
                onKeep?.(keepTypedField(form, suggestion, field, undoOptions));
                if (suggestionId !== '') {
                  setUndo((current) => {
                    if (!Object.prototype.hasOwnProperty.call(current, undoKey)) {
                      return current;
                    }
                    const next = { ...current };
                    delete next[undoKey];
                    return next;
                  });
                }
                return;
              }
              onKeep?.();
              return;
            }
            if (form && suggestion && field) {
              const result = tapReemplazar(form, suggestion, field, undoOptions);
              if (result.decision && suggestionId !== '') {
                const captured = result.previousValue;
                setUndo((current) => {
                  if (current[undoKey] === captured) {
                    return current;
                  }
                  return { ...current, [undoKey]: captured };
                });
              }
              onReplace?.(result);
              if (result.decision) {
                setToast(true);
              }
              return;
            }
            onReplace?.();
            setToast(true);
          }}
        >
          <Text style={{ fontWeight: action.highlighted ? '700' : '400' }}>{action.label}</Text>
        </Pressable>
      ))}
      {toast ? <Text>{row.toast}</Text> : null}
    </View>
  );
}
