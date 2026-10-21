import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { copyText } from '../copy/userFacing';
import { ocrSuggestionScrollTarget } from './applyOcrSuggestion';

/**
 * Inline message on the suggestion row that blocks confirm.
 * `onScrollIntoView` receives the row id so the screen can scroll that row into view.
 */
export function OcrTargetRequiredRow({
  suggestionId,
  onScrollIntoView,
}: {
  suggestionId: string;
  onScrollIntoView?: (scrollTargetId: string) => void;
}) {
  const scrollTargetId = ocrSuggestionScrollTarget(suggestionId);
  useEffect(() => {
    onScrollIntoView?.(scrollTargetId);
  }, [onScrollIntoView, scrollTargetId]);
  return (
    <View testID={scrollTargetId} nativeID={scrollTargetId}>
      <Text>{copyText('ocr.target.required')}</Text>
    </View>
  );
}
