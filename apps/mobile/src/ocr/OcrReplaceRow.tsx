import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  replaceSuggestionRow,
  tapReemplazar,
  type OcrSuggestion,
  type ReplaceFieldResult,
} from './applyOcrSuggestion';

/**
 * AC-OCR-12. A suggestion row whose field already has a value offers only
 * "Mantener lo que escribí" (default, highlighted) and "Reemplazar".
 * Reemplazar is the tap that produces action `replace`. This does not call the API.
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
  onKeep?: () => void;
  onReplace?: (result?: ReplaceFieldResult<Record<string, string>>) => void;
  form?: Record<string, string>;
  suggestion?: OcrSuggestion;
  field?: string;
}) {
  const [toast, setToast] = useState(false);
  const row = replaceSuggestionRow(actual, suggested);
  if (!row) {
    return null;
  }
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
              onKeep?.();
              return;
            }
            if (form && suggestion && field) {
              const result = tapReemplazar(form, suggestion, field);
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
