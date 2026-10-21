import { copyText } from '../copy/userFacing';

export type OcrEditFailureReason = 'editedValue' | 'retarget' | 'other';

export type OcrEditFieldError = {
  key: 'ocr.edit.invalid';
  message: string;
};

/**
 * A 422 on an OCR edit, for a bad editedValue or a retarget, uses ocr.edit.invalid.
 * Other statuses and other reasons do not.
 */
export function mapOcrEditError(input: {
  status: number;
  reason: OcrEditFailureReason;
}): OcrEditFieldError | null {
  if (input.status !== 422) {
    return null;
  }
  if (input.reason !== 'editedValue' && input.reason !== 'retarget') {
    return null;
  }
  return {
    key: 'ocr.edit.invalid',
    message: copyText('ocr.edit.invalid'),
  };
}
