import { TextInput, View } from 'react-native';
import {
  confirmOnRegistrar,
  serializeConfirmPayload,
  type OcrSuggestion,
} from './applyOcrSuggestion';
import { OcrReplaceRow, type OcrReviewForm } from './OcrReplaceRow';

export type { OcrReviewForm };

/**
 * OCR review screen. The row keeps the first Reemplazar undo in React state,
 * keyed by suggestion id and field path, and passes it into `tapReemplazar`.
 * Mantener sends `reject` and writes that undo back into the field.
 */
export function OcrSuggestionReview({
  form,
  suggestion,
  field,
  otherField,
  onFormChange,
  onConfirm,
}: {
  form: OcrReviewForm;
  suggestion: OcrSuggestion;
  field: string;
  otherField: string;
  onFormChange: (form: OcrReviewForm) => void;
  onConfirm: (body: string) => void;
}) {
  return (
    <View>
      <TextInput accessibilityLabel="Monto" testID={`ocr-field-${field}`} value={form[field] ?? ''} />
      <TextInput
        accessibilityLabel="Nota"
        testID={`ocr-field-${otherField}`}
        value={form[otherField] ?? ''}
        onChangeText={(text) => {
          onFormChange({ ...form, [otherField]: text });
        }}
      />
      <OcrReplaceRow
        actual={form[field] ?? ''}
        suggested={suggestion.value}
        form={form}
        suggestion={suggestion}
        field={field}
        onReplace={(result) => {
          if (result) {
            onFormChange(result.form);
          }
        }}
        onKeep={(result) => {
          if (!result?.decision) {
            return;
          }
          onFormChange(result.form);
          const sent = confirmOnRegistrar(result.form, [suggestion], [result.decision]);
          onConfirm(serializeConfirmPayload(sent.request?.decisions ?? []));
        }}
      />
    </View>
  );
}
