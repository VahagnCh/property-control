import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { replaceSuggestionRow } from './applyOcrSuggestion';

/**
 * Suggestion row for a field that already has a typed value.
 * Two buttons: "Mantener lo que escribí" (default, highlighted) and "Reemplazar".
 * After Reemplazar, the toast is the copy from the replace row model.
 * This does not call the API.
 */
export function OcrReplaceRow({
  actual,
  suggested,
  onKeep,
  onReplace,
}: {
  actual: string;
  suggested: string;
  onKeep?: () => void;
  onReplace?: () => void;
}) {
  const [toast, setToast] = useState(false);
  const row = replaceSuggestionRow(actual, suggested);
  if (!row) {
    return null;
  }
  return (
    <View>
      <Text>{row.prompt}</Text>
      {row.actions.map((action) => (
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
