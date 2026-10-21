import { SCREEN_STATE_COPY } from '../copy/userFacing';
import {
  BOUND_TARGET_MESSAGE,
  CLIENT_PRIOR_VALUE_MESSAGE,
  EDITED_VALUE_MESSAGE,
  FIELD_ALREADY_SET_MESSAGE,
  MISSING_DECISION_MESSAGE,
  mapOcrConfirmError,
} from './ocrEditError';

const INVALID = 'Este valor no es válido. Revisa el formato e inténtalo de nuevo.';
const ALREADY_SET = 'Este campo ya estaba guardado. Usa Reemplazar si quieres cambiarlo.';

describe('OCR confirm errors', () => {
  it('maps 409 field_already_set, including suggestionId and field, and refreshes', () => {
    expect(
      mapOcrConfirmError({
        statusCode: 409,
        message: FIELD_ALREADY_SET_MESSAGE,
        error: 'field_already_set',
        suggestionId: 'sug-1',
        field: 'providerName',
      }),
    ).toEqual({
      key: 'ocr.field.alreadySet',
      message: ALREADY_SET,
      refresh: true,
      status: 409,
      suggestionId: 'sug-1',
      field: 'providerName',
    });
    expect(mapOcrConfirmError({ status: 409, error: 'field_already_set' })).toMatchObject({
      key: 'ocr.field.alreadySet',
      refresh: true,
      status: 409,
    });
    expect(mapOcrConfirmError({ statusCode: 500, error: 'field_already_set' })).toBeNull();
    expect(mapOcrConfirmError({ statusCode: 409, error: 'Conflict' })).toBeNull();
    expect(mapOcrConfirmError({ statusCode: 409 })).toBeNull();
  });

  it('maps the clientPriorValue 422 by its message and ignores a bare 422', () => {
    expect(
      mapOcrConfirmError({
        statusCode: 422,
        message: CLIENT_PRIOR_VALUE_MESSAGE,
        error: 'Unprocessable Entity',
      }),
    ).toEqual({
      key: 'ocr.clientPriorValue',
      message: SCREEN_STATE_COPY.error,
      refresh: false,
      status: 422,
    });
    expect(mapOcrConfirmError({ statusCode: 400, message: CLIENT_PRIOR_VALUE_MESSAGE })).toBeNull();
    expect(mapOcrConfirmError({ statusCode: 422 })).toBeNull();
    expect(mapOcrConfirmError({ statusCode: 422, error: 'Unprocessable Entity' })).toBeNull();
    expect(mapOcrConfirmError({ statusCode: 422, error: 'next_due_date_out_of_range' })).toBeNull();
  });

  it('logs a missing-decision 422 and shows the generic error', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(
      mapOcrConfirmError({
        statusCode: 422,
        message: MISSING_DECISION_MESSAGE,
        suggestionId: 'sug-missing',
      }),
    ).toEqual({
      key: 'error.generic',
      message: SCREEN_STATE_COPY.error,
      refresh: false,
      status: 422,
      suggestionId: 'sug-missing',
    });
    expect(error).toHaveBeenCalledWith('OCR confirm is missing a decision.', 'sug-missing');
    expect(mapOcrConfirmError({ statusCode: 400, message: MISSING_DECISION_MESSAGE })).toBeNull();
    error.mockRestore();
  });

  it('maps a bad editedValue or a bound-target 422 to ocr.edit.invalid', () => {
    expect(
      mapOcrConfirmError({
        statusCode: 422,
        message: EDITED_VALUE_MESSAGE,
        suggestionId: 'sug-9',
        field: 'providerName',
      }),
    ).toEqual({
      key: 'ocr.edit.invalid',
      message: INVALID,
      refresh: false,
      status: 422,
      suggestionId: 'sug-9',
      field: 'providerName',
    });
    expect(mapOcrConfirmError({ statusCode: 422, message: BOUND_TARGET_MESSAGE })).toMatchObject({
      key: 'ocr.edit.invalid',
      status: 422,
    });
    expect(mapOcrConfirmError({ statusCode: 400, message: EDITED_VALUE_MESSAGE })).toBeNull();
  });
});
