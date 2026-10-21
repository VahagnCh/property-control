import { SCREEN_STATE_COPY, copyText } from '../copy/userFacing';

export type OcrMappedError = {
  key: 'ocr.edit.invalid' | 'ocr.field.alreadySet' | 'error.generic';
  message: string;
  refresh: boolean;
};

const HTTP_ERROR_NAMES = new Set(['Unprocessable Entity', 'Conflict', 'Bad Request']);

/**
 * Maps a confirm failure by its error code. The HTTP status is not consulted.
 * `edited_value_invalid` and `retarget` use ocr.edit.invalid.
 * `field_already_set` asks the screen to refresh.
 * `missing_decision` is a client bug: it is logged and shown as the generic error.
 */
export function mapOcrConfirmError(input: {
  code?: string | null;
  error?: string | null;
  status?: number;
}): OcrMappedError | null {
  const code = domainCode(input.code ?? input.error);
  if (code === 'edited_value_invalid' || code === 'retarget') {
    return { key: 'ocr.edit.invalid', message: copyText('ocr.edit.invalid'), refresh: false };
  }
  if (code === 'field_already_set') {
    return {
      key: 'ocr.field.alreadySet',
      message: copyText('ocr.field.alreadySet'),
      refresh: true,
    };
  }
  if (code === 'missing_decision') {
    console.error('OCR confirm is missing a decision.');
    return { key: 'error.generic', message: SCREEN_STATE_COPY.error, refresh: false };
  }
  return null;
}

function domainCode(code: string | null | undefined): string | null {
  if (!code || HTTP_ERROR_NAMES.has(code)) {
    return null;
  }
  return code;
}
