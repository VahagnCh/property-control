import { mapOcrEditError } from './ocrEditError';

const MESSAGE = 'Este valor no es válido. Revisa el formato e inténtalo de nuevo.';

describe('OCR edit field error', () => {
  it('maps a 422 for a bad editedValue or a retarget to ocr.edit.invalid', () => {
    expect(mapOcrEditError({ status: 422, reason: 'editedValue' })).toEqual({
      key: 'ocr.edit.invalid',
      message: MESSAGE,
    });
    expect(mapOcrEditError({ status: 422, reason: 'retarget' })).toEqual({
      key: 'ocr.edit.invalid',
      message: MESSAGE,
    });
  });

  it('does not use that copy for other statuses or other reasons', () => {
    expect(mapOcrEditError({ status: 400, reason: 'editedValue' })).toBeNull();
    expect(mapOcrEditError({ status: 409, reason: 'retarget' })).toBeNull();
    expect(mapOcrEditError({ status: 422, reason: 'other' })).toBeNull();
    expect(mapOcrEditError({ status: 500, reason: 'editedValue' })).toBeNull();
  });
});
