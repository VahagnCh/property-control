import { SCREEN_STATE_COPY } from '../copy/userFacing';
import {
  BOUND_TARGET_MESSAGE,
  BULK_ACCEPT_MESSAGE,
  CLIENT_PRIOR_VALUE_MESSAGE,
  EDITED_VALUE_MESSAGE,
  FIELD_ALREADY_SET_MESSAGE,
  JOB_EXPIRED_MESSAGE,
  JOB_NOT_SUGGESTED_MESSAGE,
  MISSING_DECISION_MESSAGE,
  MISSING_TARGET_MESSAGE,
  NEXT_DUE_DATE_CODE,
  NEXT_DUE_DATE_MESSAGE,
  UNCHECKED_PAYMENT_MESSAGE,
  VOIDED_PAYMENT_MESSAGE,
  mapOcrConfirmError,
} from './ocrEditError';

const INVALID = 'Este valor no es válido. Revisa el formato e inténtalo de nuevo.';
const CONFLICT = 'Este dato cambió. Revisa la sugerencia otra vez.';

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
      key: 'ocr.conflict',
      message: CONFLICT,
      refresh: true,
      status: 409,
      suggestionId: 'sug-1',
      field: 'providerName',
    });
    expect(mapOcrConfirmError({ status: 409, error: 'field_already_set' })).toMatchObject({
      key: 'ocr.conflict',
      message: CONFLICT,
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
    expect(mapOcrConfirmError({ statusCode: 400, error: NEXT_DUE_DATE_CODE })).toBeNull();
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

  it('maps a bad editedValue to ocr.edit.invalid and a bound target to ocr.target.locked', () => {
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
    expect(mapOcrConfirmError({ statusCode: 422, message: BOUND_TARGET_MESSAGE, suggestionId: 'sug-bound' })).toEqual({
      key: 'ocr.target.locked',
      message: 'Esta sugerencia ya está ligada a otro registro. Revísala otra vez.',
      refresh: false,
      status: 422,
      suggestionId: 'sug-bound',
    });
    expect(mapOcrConfirmError({ statusCode: 400, message: EDITED_VALUE_MESSAGE })).toBeNull();
    expect(mapOcrConfirmError({ statusCode: 400, message: BOUND_TARGET_MESSAGE })).toBeNull();
  });

  it('maps the other confirm messages by status and keeps a bare 422 unmapped', () => {
    expect(mapOcrConfirmError({ statusCode: 422, message: MISSING_TARGET_MESSAGE, suggestionId: 'sug-open' })).toEqual({
      key: 'ocr.target.required',
      message: 'Elige a qué pago aplica esta sugerencia.',
      refresh: false,
      status: 422,
      suggestionId: 'sug-open',
    });
    expect(mapOcrConfirmError({ statusCode: 422, message: VOIDED_PAYMENT_MESSAGE })).toMatchObject({
      key: 'ocr.target.voided',
      message: 'Este registro ya no se puede usar. Elige otro o descarta la sugerencia.',
    });
    expect(mapOcrConfirmError({ statusCode: 422, message: UNCHECKED_PAYMENT_MESSAGE })).toMatchObject({
      key: 'ocr.target.unchecked',
      message: 'No pudimos comprobar el registro de destino. Elige otro o descarta la sugerencia.',
    });
    expect(mapOcrConfirmError({ statusCode: 422, message: BULK_ACCEPT_MESSAGE })).toMatchObject({
      key: 'ocr.bulk.refused',
      message: 'Hay que decidir cada sugerencia por separado.',
    });
    expect(mapOcrConfirmError({ statusCode: 422, message: NEXT_DUE_DATE_MESSAGE })).toMatchObject({
      key: 'obligation.nextDueDate.invalid',
      message: 'La próxima fecha no es válida. Revisa el valor e inténtalo de nuevo.',
    });
    expect(mapOcrConfirmError({ statusCode: 422, error: NEXT_DUE_DATE_CODE })).toMatchObject({
      key: 'obligation.nextDueDate.invalid',
    });
    expect(mapOcrConfirmError({ statusCode: 409, message: JOB_NOT_SUGGESTED_MESSAGE })).toEqual({
      key: 'ocr.job.notSuggested',
      message: 'Esta revisión ya estaba registrada. Actualiza la pantalla.',
      refresh: true,
      status: 409,
    });
    expect(
      mapOcrConfirmError({
        statusCode: 409,
        message: JOB_NOT_SUGGESTED_MESSAGE,
        error: 'field_already_set',
      }),
    ).toMatchObject({ key: 'ocr.conflict', refresh: true });
    expect(mapOcrConfirmError({ statusCode: 410, message: JOB_EXPIRED_MESSAGE })).toEqual({
      key: 'ocr.job.expired',
      message: 'Esta revisión ya no está disponible. Vuelve a intentarlo.',
      refresh: false,
      status: 410,
    });
    expect(mapOcrConfirmError({ statusCode: 422, message: JOB_EXPIRED_MESSAGE })).toBeNull();
    expect(mapOcrConfirmError({ statusCode: 422, message: 'something else' })).toBeNull();
  });
});
