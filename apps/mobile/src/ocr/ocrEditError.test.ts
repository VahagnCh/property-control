import { SCREEN_STATE_COPY } from '../copy/userFacing';
import { mapOcrConfirmError } from './ocrEditError';

const INVALID = 'Este valor no es válido. Revisa el formato e inténtalo de nuevo.';
const ALREADY_SET = 'Este campo ya estaba guardado. Usa Reemplazar si quieres cambiarlo.';

describe('OCR confirm errors', () => {
  it('maps edited_value_invalid and retarget by code to ocr.edit.invalid', () => {
    for (const status of [200, 400, 409, 422, 500]) {
      expect(mapOcrConfirmError({ code: 'edited_value_invalid', status })).toEqual({
        key: 'ocr.edit.invalid',
        message: INVALID,
        refresh: false,
      });
      expect(mapOcrConfirmError({ error: 'retarget', status })).toEqual({
        key: 'ocr.edit.invalid',
        message: INVALID,
        refresh: false,
      });
    }
  });

  it('does not use that copy when the code is absent, including on a 422', () => {
    expect(mapOcrConfirmError({ status: 422 })).toBeNull();
    expect(mapOcrConfirmError({ status: 422, error: 'Unprocessable Entity' })).toBeNull();
    expect(mapOcrConfirmError({ status: 422, code: 'next_due_date_out_of_range' })).toBeNull();
    expect(mapOcrConfirmError({ status: 400, code: 'editedValue' })).toBeNull();
    expect(mapOcrConfirmError({ code: 'something_else' })).toBeNull();
  });

  it('maps field_already_set by code, asks for a refresh, and ignores the status', () => {
    expect(mapOcrConfirmError({ code: 'field_already_set', status: 409 })).toEqual({
      key: 'ocr.field.alreadySet',
      message: ALREADY_SET,
      refresh: true,
    });
    expect(mapOcrConfirmError({ error: 'field_already_set', status: 500 })).toEqual({
      key: 'ocr.field.alreadySet',
      message: ALREADY_SET,
      refresh: true,
    });
    expect(mapOcrConfirmError({ status: 409 })).toBeNull();
    expect(mapOcrConfirmError({ status: 409, code: 'already_voided' })).toBeNull();
  });

  it('logs a missing decision and shows the generic error', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(mapOcrConfirmError({ code: 'missing_decision', status: 422 })).toEqual({
      key: 'error.generic',
      message: SCREEN_STATE_COPY.error,
      refresh: false,
    });
    expect(error).toHaveBeenCalledWith('OCR confirm is missing a decision.');
    error.mockRestore();
  });
});
