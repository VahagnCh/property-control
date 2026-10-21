import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ManualClock } from './clock.js';
import type { OcrExtractor } from './ocr-extractor.js';
import type { OcrTargetLookup } from './ocr-target-lookup.js';
import { canonicalizeMxText } from './ocr-locale.js';
import { NEXT_DUE_DATE_ERROR } from '../obligations/next-due-date.js';
import { loadOcrRuntime } from './ocr-runtime.js';
import { OcrService } from './ocr.service.js';
import { paymentCreateAuditFromReplace, type OcrDecision, type OcrSuggestion } from './ocr.types.js';
import { DOCUMENT_SOURCE_KEY } from '../evidence/storage-key.js';
import { PrivateObjectStorage } from './object-storage.js';

const PROPERTY = '11111111-1111-4111-8111-111111111111';
const DOCUMENT = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_2 = '22222222-2222-4222-8222-333333333333';
const OBLIGATION = '33333333-3333-4333-8333-333333333333';
const OTHER_OBLIGATION = '33333333-3333-4333-8333-444444444444';
const PAYMENT = '44444444-4444-4444-8444-444444444444';
const FORGED = '55555555-5555-4555-8555-555555555555';

function lookup(documents: string[] = [DOCUMENT]): OcrTargetLookup {
  const docs = new Set(documents);
  return {
    belongsToProperty({ entityType, entityId }) {
      if (entityType === 'obligation') {
        return entityId === OBLIGATION;
      }
      if (entityType === 'payment') {
        return entityId === PAYMENT;
      }
      if (entityType === 'document_meta') {
        return docs.has(entityId);
      }
      return false;
    },
  };
}

function serviceWith(
  overrides: {
    lookup?: OcrTargetLookup;
    clock?: ManualClock;
    extractor?: OcrExtractor;
    storage?: PrivateObjectStorage;
    jobsMax?: number;
    jobsGlobalMax?: number;
    jobTtlMs?: number;
    confidenceBands?: { alta: number; media: number };
  } = {},
): OcrService {
  return new OcrService(
    {
      enabled: true,
      jobsMax: overrides.jobsMax ?? 50,
      ...(overrides.jobsGlobalMax !== undefined ? { jobsGlobalMax: overrides.jobsGlobalMax } : {}),
      jobTtlMs: overrides.jobTtlMs ?? 15 * 60 * 1000,
      ...(overrides.confidenceBands ? { confidenceBands: overrides.confidenceBands } : {}),
    },
    overrides.lookup ?? lookup(),
    overrides.clock,
    overrides.extractor,
    overrides.storage,
  );
}

function decisions(
  suggestions: OcrSuggestion[],
  map: (row: OcrSuggestion) => OcrDecision,
): OcrDecision[] {
  return suggestions.map(map);
}

describe('OcrService', () => {
  function suggestionMap(service: OcrService, propertyId: string, jobId: string) {
    return service.getJob(propertyId, jobId).suggestions;
  }

  it('stops the stub worker at suggested and leaves every suggestion pending', () => {
    const storage = new PrivateObjectStorage();
    const service = serviceWith({ storage });
    const { job, created } = service.enqueue(PROPERTY, DOCUMENT);

    expect(created).toBe(true);
    expect(job.status).toBe('suggested');
    expect(job.vendor).toBe('stub');
    expect(job).not.toHaveProperty('storageKey');
    expect(JSON.stringify(job)).not.toMatch(/storageKey|storage_key|properties\//i);
    expect(storage.calls).toHaveLength(1);
    expect(storage.calls[0]).toMatch(DOCUMENT_SOURCE_KEY);
    expect(storage.calls[0]).not.toContain(PROPERTY);
    expect(storage.calls[0]).not.toContain(DOCUMENT);

    const suggestions = suggestionMap(service, PROPERTY, job.id);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((row) => row.applyStatus === 'pending')).toBe(true);
    expect(job.confidenceBands).toEqual({ alta: 0.9, media: 0.8 });
    const amount = suggestions.find((row) => row.fieldPath === 'expectedAmount');
    expect(amount?.confidence).toBe(0.81);
    expect(amount?.band).toBe('media');
    expect(amount?.lowConfidence).toBe(false);
    expect(suggestions.filter((row) => row.fieldPath !== 'expectedAmount').every((row) => row.band === 'revisa')).toBe(true);
    expect(suggestions.filter((row) => row.fieldPath !== 'expectedAmount').every((row) => row.lowConfidence)).toBe(true);
  });

  it('rejects a non-UUID property or document id before building a storage key', () => {
    const storage = new PrivateObjectStorage();
    const service = serviceWith({ storage });
    expect(() => service.enqueue('property-1', DOCUMENT)).toThrow(BadRequestException);
    try {
      service.enqueue(PROPERTY, 'document-1');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        error: 'invalid_path',
        statusCode: 400,
      });
    }
    expect(storage.calls).toEqual([]);
  });

  it('reuses an open job for the same document', () => {
    const service = serviceWith();
    const first = service.enqueue(PROPERTY, DOCUMENT);
    const second = service.enqueue(PROPERTY, DOCUMENT);

    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job).not.toHaveProperty('storageKey');
  });

  it('rejects a job when every suggestion is rejected and writes nothing', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);

    const result = await service.confirm(
      PROPERTY,
      job.id,
      suggestions.map((row) => ({ suggestionId: row.id, action: 'reject' as const })),
    );

    expect(result.job.status).toBe('rejected');
    expect(result.applied).toEqual([]);
    expect(result.persisted).toBe(false);
    expect(result.job).not.toHaveProperty('storageKey');
    expect(result.suggestions.every((row) => row.applyStatus === 'rejected')).toBe(true);
  });

  it('requires a target before accepting an unbound obligation field', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);

    await expect(
      service.confirm(
        PROPERTY,
        job.id,
        suggestions.map((row) => ({ suggestionId: row.id, action: 'accept' as const })),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(
      suggestionMap(service, PROPERTY, job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);
  });

  it('records accept and edit only from confirm, without a persistence call', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const amount = suggestions.find((row) => row.fieldPath === 'expectedAmount');
    const due = suggestions.find((row) => row.fieldPath === 'nextDueDate');
    expect(amount).toBeDefined();
    expect(due).toBeDefined();

    const nonUuid = decisions(suggestions, (row) => {
      if (row.id === amount?.id) {
        return {
          suggestionId: row.id,
          action: 'edit' as const,
          editedValue: { amount: '19000.00', currency: 'MXN' },
          targetEntityId: 'obligation-9',
        };
      }
      if (row.targetEntityType === 'obligation') {
        return {
          suggestionId: row.id,
          action: 'accept' as const,
          targetEntityId: 'obligation-9',
        };
      }
      return { suggestionId: row.id, action: 'reject' as const };
    });
    await expect(service.confirm(PROPERTY, job.id, nonUuid)).rejects.toBeInstanceOf(BadRequestException);
    expect(
      suggestionMap(service, PROPERTY, job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);

    const result = await service.confirm(
      PROPERTY,
      job.id,
      decisions(suggestions, (row) => {
        if (row.id === amount?.id) {
          return {
            suggestionId: row.id,
            action: 'edit' as const,
            editedValue: '19000.00',
            targetEntityId: OBLIGATION,
          };
        }
        if (row.targetEntityType === 'obligation') {
          return {
            suggestionId: row.id,
            action: 'accept' as const,
            targetEntityId: OBLIGATION,
          };
        }
        return { suggestionId: row.id, action: 'reject' as const };
      }),
    );

    expect(result.persisted).toBe(false);
    expect(result.job).not.toHaveProperty('storageKey');
    expect(result.job.status).toBe('confirmed');
    expect(result.applied.map((row) => row.fieldPath).sort()).toEqual([
      'expectedAmount',
      'nextDueDate',
      'providerName',
    ]);
    const edited = result.suggestions.find((row) => row.id === amount?.id);
    expect(edited?.applyStatus).toBe('accepted');
    expect(edited?.userEditedValue).toBe('19000.00');
    await expect(service.confirm(PROPERTY, job.id, [])).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a non-UUID targetEntityId', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    await expect(
      service.confirm(
        PROPERTY,
        job.id,
        suggestions.map((row) =>
          row.targetEntityType === 'document_meta'
            ? { suggestionId: row.id, action: 'reject' as const }
            : { suggestionId: row.id, action: 'accept' as const, targetEntityId: 'obligation-9' },
        ),
      ),
    ).rejects.toMatchObject({ response: { error: 'target_invalid', statusCode: 400 } });
  });

  it('rejects numeric, null, and array targetEntityId values and unknown decision fields', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const amount = suggestions.find((row) => row.fieldPath === 'expectedAmount');
    expect(amount).toBeDefined();
    const rest = suggestions
      .filter((row) => row.id !== amount?.id)
      .map((row) => ({ suggestionId: row.id, action: 'reject' as const }));

    await expect(
      service.confirm(PROPERTY, job.id, [
        { suggestionId: amount?.id, action: 'accept', targetEntityId: 12 },
        ...rest,
      ]),
    ).rejects.toMatchObject({ response: { error: 'target_invalid', statusCode: 400 } });
    await expect(
      service.confirm(PROPERTY, job.id, [
        { suggestionId: amount?.id, action: 'accept', targetEntityId: null },
        ...rest,
      ]),
    ).rejects.toMatchObject({ response: { error: 'target_invalid', statusCode: 400 } });
    await expect(
      service.confirm(PROPERTY, job.id, [
        { suggestionId: amount?.id, action: 'accept', targetEntityId: [OBLIGATION] },
        ...rest,
      ]),
    ).rejects.toMatchObject({ response: { error: 'target_invalid', statusCode: 400 } });
    await expect(
      service.confirm(PROPERTY, job.id, [
        { suggestionId: amount?.id, action: 'accept', targetEntityId: OBLIGATION, extra: true },
        ...rest,
      ]),
    ).rejects.toMatchObject({ response: { error: 'unknown_field', statusCode: 400 } });
    expect(
      suggestionMap(service, PROPERTY, job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);
  });

  it('returns 404 for a forged, foreign, or wrong-type target', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const amount = suggestions.find((row) => row.fieldPath === 'expectedAmount');
    expect(amount).toBeDefined();
    const body = (targetEntityId: string) =>
      suggestions.map((row) =>
        row.id === amount?.id
          ? { suggestionId: row.id, action: 'accept' as const, targetEntityId }
          : { suggestionId: row.id, action: 'reject' as const },
      );

    await expect(service.confirm(PROPERTY, job.id, body(FORGED))).rejects.toMatchObject({
      response: { error: 'not_found', message: 'Not found.', statusCode: 404 },
    });
    await expect(service.confirm(PROPERTY, job.id, body(OTHER_OBLIGATION))).rejects.toMatchObject({
      response: { error: 'not_found', message: 'Not found.', statusCode: 404 },
    });
    await expect(service.confirm(PROPERTY, job.id, body(PAYMENT))).rejects.toMatchObject({
      response: { error: 'not_found', message: 'Not found.', statusCode: 404 },
    });
    expect(
      suggestionMap(service, PROPERTY, job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);
  });

  it('names the suggestion and field when editedValue is invalid', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const amount = suggestions.find((row) => row.fieldPath === 'expectedAmount');
    expect(amount).toBeDefined();
    const body = suggestions.map((row) =>
      row.id === amount?.id
        ? { suggestionId: row.id, action: 'edit' as const, editedValue: '0.00', targetEntityId: OBLIGATION }
        : { suggestionId: row.id, action: 'reject' as const },
    );
    await expect(service.confirm(PROPERTY, job.id, body)).rejects.toBeInstanceOf(UnprocessableEntityException);
    try {
      await service.confirm(PROPERTY, job.id, body);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getStatus()).toBe(422);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        error: 'edited_value_invalid',
        message: 'editedValue does not match fieldPath.',
        suggestionId: amount?.id,
        field: 'expectedAmount',
      });
    }
    expect(
      suggestionMap(service, PROPERTY, job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);
  });

  it('names the suggestion when an accepted suggested value is invalid', async () => {
    const service = serviceWith({
      extractor: {
        extract: () => ({
          outcome: 'suggested',
          suggestions: [
            {
              targetEntityType: 'obligation',
              fieldPath: 'expectedAmount',
              suggestedValue: '1,234',
              confidence: 0.95,
            },
          ],
        }),
      },
    });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const [amount] = suggestionMap(service, PROPERTY, job.id);
    expect(amount).toBeDefined();
    try {
      await service.confirm(PROPERTY, job.id, [
        { suggestionId: amount?.id ?? '', action: 'accept', targetEntityId: OBLIGATION },
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        error: 'edited_value_invalid',
        suggestionId: amount?.id,
        field: 'expectedAmount',
      });
    }
  });

  it('rejects a retarget of a bound suggestion', async () => {
    const service = serviceWith({
      lookup: {
        belongsToProperty({ entityType, entityId }) {
          if (entityType === 'obligation') {
            return entityId === OBLIGATION || entityId === OTHER_OBLIGATION;
          }
          if (entityType === 'document_meta') {
            return entityId === DOCUMENT;
          }
          return false;
        },
      },
      extractor: {
        extract: () => ({
          outcome: 'suggested',
          suggestions: [
            {
              targetEntityType: 'obligation',
              targetEntityId: OBLIGATION,
              fieldPath: 'providerName',
              suggestedValue: 'BBVA Hipoteca',
              confidence: 0.95,
            },
          ],
        }),
      },
    });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const [row] = suggestionMap(service, PROPERTY, job.id);
    expect(row?.targetEntityId).toBe(OBLIGATION);
    await expect(
      service.confirm(PROPERTY, job.id, [
        { suggestionId: row?.id ?? '', action: 'accept', targetEntityId: OTHER_OBLIGATION },
      ]),
    ).rejects.toMatchObject({
      response: {
        error: 'bound_target_immutable',
        message: 'A bound target cannot be changed.',
        statusCode: 422,
      },
    });
    await expect(
      service.confirm(PROPERTY, job.id, [
        { suggestionId: row?.id ?? '', action: 'accept', targetEntityId: FORGED },
      ]),
    ).rejects.toMatchObject({ response: { error: 'not_found', statusCode: 404 } });
    const kept = await service.confirm(PROPERTY, job.id, [
      { suggestionId: row?.id ?? '', action: 'accept', targetEntityId: OBLIGATION },
    ]);
    expect(kept.applied).toEqual([
      {
        suggestionId: row?.id,
        entityType: 'obligation',
        entityId: OBLIGATION,
        fieldPath: 'providerName',
      },
    ]);
    expect(kept.persisted).toBe(false);
  });

  it('requires a UUID target on an unbound accept or edit', async () => {
    const service = serviceWith({
      extractor: {
        extract: () => ({
          outcome: 'suggested',
          suggestions: [
            {
              targetEntityType: 'obligation',
              fieldPath: 'providerName',
              suggestedValue: 'BBVA Hipoteca',
              confidence: 0.95,
            },
          ],
        }),
      },
    });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const [row] = suggestionMap(service, PROPERTY, job.id);
    const id = row?.id ?? '';
    await expect(
      service.confirm(PROPERTY, job.id, [{ suggestionId: id, action: 'accept' }]),
    ).rejects.toMatchObject({ response: { error: 'target_required', statusCode: 422 } });
    await expect(
      service.confirm(PROPERTY, job.id, [
        { suggestionId: id, action: 'edit', editedValue: 'Otro banco' },
      ]),
    ).rejects.toMatchObject({ response: { error: 'target_required', statusCode: 422 } });
    await expect(
      service.confirm(PROPERTY, job.id, [
        { suggestionId: id, action: 'replace' },
      ]),
    ).rejects.toMatchObject({ response: { error: 'target_required', statusCode: 422 } });
    await expect(
      service.confirm(PROPERTY, job.id, [
        { suggestionId: id, action: 'accept', targetEntityId: 'obligation-9' },
      ]),
    ).rejects.toMatchObject({ response: { error: 'target_invalid', statusCode: 400 } });
    await expect(
      service.confirm(PROPERTY, job.id, [
        { suggestionId: id, action: 'edit', editedValue: 'Otro banco', targetEntityId: 'obligation-9' },
      ]),
    ).rejects.toMatchObject({ response: { error: 'target_invalid', statusCode: 400 } });
    expect(suggestionMap(service, PROPERTY, job.id)[0]?.applyStatus).toBe('pending');
  });

  it('returns 404 for a soft-deleted target and 422 for a voided payment', async () => {
    const softDeleted = '33333333-3333-4333-8333-666666666666';
    const voided = '44444444-4444-4444-8444-555555555555';
    const knownPayments = new Set<string>([PAYMENT]);
    const service = serviceWith({
      lookup: {
        belongsToProperty({ entityType, entityId }) {
          if (entityType === 'obligation') {
            return entityId === OBLIGATION;
          }
          if (entityType === 'payment') {
            return entityId === PAYMENT || entityId === voided;
          }
          if (entityType === 'document_meta') {
            return entityId === DOCUMENT;
          }
          return false;
        },
        paymentStatus({ entityId }) {
          return entityId === voided ? 'voided' : 'recorded';
        },
      },
      extractor: {
        extract: () => ({
          outcome: 'suggested',
          suggestions: [
            {
              targetEntityType: 'obligation',
              fieldPath: 'providerName',
              suggestedValue: 'BBVA Hipoteca',
              confidence: 0.95,
            },
            {
              targetEntityType: 'payment',
              fieldPath: 'expectedAmount',
              suggestedValue: '100.00',
              confidence: 0.95,
            },
          ],
        }),
      },
    });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const provider = suggestions.find((row) => row.fieldPath === 'providerName');
    const amount = suggestions.find((row) => row.targetEntityType === 'payment');
    const decisionsFor = (providerTarget: string, paymentTarget: string) => [
      { suggestionId: provider?.id ?? '', action: 'accept' as const, targetEntityId: providerTarget },
      { suggestionId: amount?.id ?? '', action: 'accept' as const, targetEntityId: paymentTarget },
    ];

    await expect(
      service.confirm(PROPERTY, job.id, decisionsFor(softDeleted, PAYMENT)),
    ).rejects.toMatchObject({ response: { error: 'not_found', statusCode: 404 } });
    await expect(
      service.confirm(PROPERTY, job.id, decisionsFor(OBLIGATION, voided)),
    ).rejects.toMatchObject({
      response: { error: 'target_voided', message: 'A voided payment cannot be a confirm target.', statusCode: 422 },
    });
    expect(knownPayments).toEqual(new Set([PAYMENT]));
    expect(
      suggestionMap(service, PROPERTY, job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);

    const result = await service.confirm(PROPERTY, job.id, decisionsFor(OBLIGATION, PAYMENT));
    expect(result.persisted).toBe(false);
    expect(result.applied.map((row) => row.entityId).sort()).toEqual([OBLIGATION, PAYMENT].sort());
    expect(knownPayments).toEqual(new Set([PAYMENT]));
    expect(Object.getOwnPropertyNames(OcrService.prototype)).not.toContain('createPayment');
  });

  it('rejects document_meta retargets in the same property and hides foreign documents', async () => {
    const service = serviceWith({ lookup: lookup([DOCUMENT, DOCUMENT_2]) });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const title = suggestions.find((row) => row.targetEntityType === 'document_meta');
    expect(title).toBeDefined();
    const body = (targetEntityId: string) =>
      suggestions.map((row) =>
        row.id === title?.id
          ? { suggestionId: row.id, action: 'accept' as const, targetEntityId }
          : { suggestionId: row.id, action: 'reject' as const },
      );

    await expect(service.confirm(PROPERTY, job.id, body(DOCUMENT_2))).rejects.toMatchObject({
      response: { error: 'bound_target_immutable', statusCode: 422 },
    });
    await expect(service.confirm(PROPERTY, job.id, body(FORGED))).rejects.toMatchObject({
      response: { error: 'not_found', statusCode: 404 },
    });
    expect(
      suggestionMap(service, PROPERTY, job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);
  });

  it('rejects edited values that do not match the field', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const cases: Array<{ fieldPath: string; editedValue: unknown }> = [
      { fieldPath: 'expectedAmount', editedValue: -1 },
      { fieldPath: 'expectedAmount', editedValue: '0.00' },
      { fieldPath: 'expectedAmount', editedValue: '-1.00' },
      { fieldPath: 'expectedAmount', editedValue: '21474836.48' },
      { fieldPath: 'expectedAmount', editedValue: '1.234' },
      { fieldPath: 'expectedAmount', editedValue: 'NaN' },
      { fieldPath: 'expectedAmount', editedValue: 'Infinity' },
      { fieldPath: 'expectedAmount', editedValue: { amount: '10.00', currency: 'MXN' } },
      { fieldPath: 'nextDueDate', editedValue: '2026-02-30' },
      { fieldPath: 'nextDueDate', editedValue: '1989-12-31' },
      { fieldPath: 'nextDueDate', editedValue: '2101-01-01' },
      { fieldPath: 'nextDueDate', editedValue: '05/10/2026' },
      { fieldPath: 'providerName', editedValue: '' },
      { fieldPath: 'providerName', editedValue: '   ' },
      { fieldPath: 'providerName', editedValue: 'bad\u0000name' },
      { fieldPath: 'providerName', editedValue: 'c1\u0085name' },
      { fieldPath: 'providerName', editedValue: 'bidi\u202Ename' },
      { fieldPath: 'providerName', editedValue: 'bidi\u2066name' },
      { fieldPath: 'providerName', editedValue: 'zw\u200Bname' },
      { fieldPath: 'providerName', editedValue: 'zw\uFEFFname' },
      { fieldPath: 'providerName', editedValue: 'zw\u2060name' },
      { fieldPath: 'providerName', editedValue: 'line\nbreak' },
      { fieldPath: 'providerName', editedValue: 'x'.repeat(201) },
      { fieldPath: 'title', editedValue: 'x'.repeat(301) },
      { fieldPath: 'title', editedValue: '' },
    ];

    for (const testCase of cases) {
      const payload = suggestions.map((row) => {
        if (row.fieldPath !== testCase.fieldPath) {
          return { suggestionId: row.id, action: 'reject' as const };
        }
        return {
          suggestionId: row.id,
          action: 'edit' as const,
          editedValue: testCase.editedValue,
          targetEntityId: row.targetEntityType === 'document_meta' ? undefined : OBLIGATION,
        };
      });
      const window = testCase.editedValue === '1989-12-31' || testCase.editedValue === '2101-01-01';
      await expect(service.confirm(PROPERTY, job.id, payload)).rejects.toMatchObject({
        response: {
          error: window ? 'next_due_date_out_of_range' : 'edited_value_invalid',
          suggestionId: suggestions.find((row) => row.fieldPath === testCase.fieldPath)?.id,
          field: testCase.fieldPath,
          statusCode: 422,
        },
      });
    }
    expect(
      suggestionMap(service, PROPERTY, job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);
  });

  it('stores Spanish text as inert NFC and treats NFD as the same string', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const nfd = 'Servicio de Agua Potable – Muñoz'.normalize('NFD');
    const result = await service.confirm(
      PROPERTY,
      job.id,
      suggestions.map((row) => {
        if (row.fieldPath === 'providerName') {
          return {
            suggestionId: row.id,
            action: 'edit' as const,
            editedValue: nfd,
            targetEntityId: OBLIGATION,
          };
        }
        if (row.fieldPath === 'title') {
          return {
            suggestionId: row.id,
            action: 'edit' as const,
            editedValue: '<script>alert(1)</script>',
          };
        }
        return { suggestionId: row.id, action: 'reject' as const };
      }),
    );
    const provider = result.suggestions.find((row) => row.fieldPath === 'providerName');
    const title = result.suggestions.find((row) => row.fieldPath === 'title');
    expect(provider?.userEditedValue).toBe(canonicalizeMxText(nfd));
    expect(provider?.userEditedValue).toBe('Servicio de Agua Potable – Muñoz');
    expect(String(provider?.userEditedValue)).toContain('ñ');
    expect(title?.userEditedValue).toBe('<script>alert(1)</script>');
    expect(result.persisted).toBe(false);
  });

  it('rejects an unknown fieldPath and prototype paths', async () => {
    const extractor: OcrExtractor = {
      extract: () => ({
        outcome: 'suggested',
        suggestions: [
          {
            targetEntityType: 'obligation',
            fieldPath: 'notAField',
            suggestedValue: 'x',
            confidence: 0.9,
          },
          {
            targetEntityType: 'obligation',
            fieldPath: '__proto__',
            suggestedValue: 'x',
            confidence: 0.9,
          },
        ],
      }),
    };
    const service = serviceWith({ extractor });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    await expect(
      service.confirm(
        PROPERTY,
        job.id,
        suggestions.map((row) => ({
          suggestionId: row.id,
          action: 'edit' as const,
          editedValue: 'ok',
          targetEntityId: OBLIGATION,
        })),
      ),
    ).rejects.toMatchObject({ response: { error: 'field_path_unknown', statusCode: 400 } });
    expect(
      suggestionMap(service, PROPERTY, job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);
  });

  it('keeps an empty extraction suggested and does not auto-apply', () => {
    const service = serviceWith({
      extractor: { extract: () => ({ outcome: 'suggested', suggestions: [] }) },
    });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    expect(job.status).toBe('suggested');
    expect(suggestionMap(service, PROPERTY, job.id)).toEqual([]);
    expect(job.status).not.toBe('confirmed');
  });

  it('flags a low-confidence field and leaves it pending', () => {
    const service = serviceWith({
      extractor: {
        extract: () => ({
          outcome: 'suggested',
          suggestions: [
            {
              targetEntityType: 'obligation',
              fieldPath: 'providerName',
              suggestedValue: 'Predial Coyoacán',
              confidence: 0.2,
            },
            {
              targetEntityType: 'obligation',
              fieldPath: 'expectedAmount',
              suggestedValue: '1.234',
              confidence: 0.95,
            },
          ],
        }),
      },
    });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    expect(job.status).toBe('suggested');
    expect(suggestions.every((row) => row.applyStatus === 'pending')).toBe(true);
    expect(suggestions.every((row) => row.lowConfidence)).toBe(true);
  });

  it('confirming a failed or not-yet-suggested job returns 409 and keeps no partial suggestions', async () => {
    const failed = serviceWith({
      extractor: {
        extract: () => ({
          outcome: 'failed',
          error: 'corrupt',
          suggestions: [
            {
              targetEntityType: 'obligation',
              fieldPath: 'providerName',
              suggestedValue: 'partial',
            },
          ],
        }),
      },
    });
    const failedJob = failed.enqueue(PROPERTY, DOCUMENT).job;
    expect(failedJob.status).toBe('failed');
    expect(failedJob.errorCode).toBe('extract_failed');
    expect(JSON.stringify(failedJob)).not.toMatch(/corrupt/);
    expect(failed.getJob(PROPERTY, failedJob.id).suggestions).toEqual([]);
    await expect(failed.confirm(PROPERTY, failedJob.id, [])).rejects.toMatchObject({
      response: { error: 'job_not_confirmable', statusCode: 409 },
    });

    const pending = serviceWith({
      extractor: { extract: () => ({ outcome: 'pending' }) },
    });
    const pendingJob = pending.enqueue(PROPERTY, DOCUMENT_2).job;
    expect(pendingJob.status).toBe('pending');
    await expect(pending.confirm(PROPERTY, pendingJob.id, { decisions: [] })).rejects.toMatchObject({
      response: { error: 'job_not_confirmable', statusCode: 409 },
    });

    const processing = serviceWith({
      extractor: { extract: () => ({ outcome: 'processing' }) },
    });
    const processingJob = processing.enqueue(PROPERTY, DOCUMENT).job;
    expect(processingJob.status).toBe('processing');
    await expect(processing.confirm(PROPERTY, processingJob.id, [])).rejects.toMatchObject({
      response: { error: 'job_not_confirmable', statusCode: 409 },
    });
  });

  it('lets exactly one of two concurrent confirms win', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const payload = suggestions.map((row) => ({ suggestionId: row.id, action: 'reject' as const }));
    const [first, second] = await Promise.allSettled([
      service.confirm(PROPERTY, job.id, payload),
      service.confirm(PROPERTY, job.id, payload),
    ]);
    const fulfilled = [first, second].filter((result) => result.status === 'fulfilled');
    const rejected = [first, second].filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(((rejected[0] as PromiseRejectedResult).reason as ConflictException).getResponse()).toMatchObject({
      error: 'job_not_confirmable',
    });
    expect(suggestionMap(service, PROPERTY, job.id).every((row) => row.applyStatus === 'rejected')).toBe(
      true,
    );
  });

  it('does not evict a suggested job when the map is full', () => {
    const service = serviceWith({ jobsMax: 2 });
    const first = service.enqueue(PROPERTY, DOCUMENT).job;
    const second = service.enqueue(PROPERTY, DOCUMENT_2).job;
    expect(() =>
      service.enqueue(PROPERTY, '33333333-3333-4333-8333-555555555555'),
    ).toThrow(HttpException);
    try {
      service.enqueue(PROPERTY, '33333333-3333-4333-8333-555555555555');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect((error as HttpException).getResponse()).toMatchObject({ error: 'ocr_capacity', statusCode: 429 });
    }
    expect(service.getJob(PROPERTY, first.id).job.status).toBe('suggested');
    expect(service.getJob(PROPERTY, second.id).job.status).toBe('suggested');
  });

  it('lets another property enqueue when this property is at its cap', () => {
    const otherProperty = '11111111-1111-4111-8111-222222222222';
    const service = serviceWith({ jobsMax: 1 });
    const held = service.enqueue(PROPERTY, DOCUMENT).job;
    expect(() => service.enqueue(PROPERTY, DOCUMENT_2)).toThrow(HttpException);
    const other = service.enqueue(otherProperty, DOCUMENT);
    expect(other.created).toBe(true);
    expect(service.getJob(PROPERTY, held.id).job.status).toBe('suggested');
  });

  it('does not let an empty suggested job occupy a cap slot', () => {
    const service = serviceWith({
      jobsMax: 1,
      extractor: { extract: () => ({ outcome: 'suggested', suggestions: [] }) },
    });
    expect(service.enqueue(PROPERTY, DOCUMENT).created).toBe(true);
    expect(service.enqueue(PROPERTY, DOCUMENT_2).created).toBe(true);
  });

  it('stops at the global ceiling without evicting a suggested job', () => {
    const otherProperty = '11111111-1111-4111-8111-222222222222';
    const service = serviceWith({ jobsMax: 5, jobsGlobalMax: 1 });
    const held = service.enqueue(PROPERTY, DOCUMENT).job;
    expect(() => service.enqueue(otherProperty, DOCUMENT)).toThrow(HttpException);
    try {
      service.enqueue(otherProperty, DOCUMENT);
      expect.unreachable();
    } catch (error) {
      expect((error as HttpException).getResponse()).toMatchObject({ error: 'ocr_capacity', statusCode: 429 });
    }
    expect(service.getJob(PROPERTY, held.id).job.status).toBe('suggested');
  });

  it('rejects an unknown job before queueing and clears the confirm tail', async () => {
    const service = serviceWith();
    expect(() => service.confirm(PROPERTY, FORGED, { decisions: [] })).toThrow(NotFoundException);
    try {
      service.confirm(PROPERTY, FORGED, { decisions: [] });
      expect.unreachable();
    } catch (error) {
      expect((error as NotFoundException).getResponse()).toMatchObject({ error: 'not_found', message: 'Not found.' });
    }
    expect(service.confirmQueueSize()).toBe(0);

    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    try {
      service.confirm(DOCUMENT, job.id, []);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({ error: 'not_found' });
    }
    expect(service.confirmQueueSize()).toBe(0);

    const suggestions = suggestionMap(service, PROPERTY, job.id);
    await service.confirm(
      PROPERTY,
      job.id,
      suggestions.map((row) => ({ suggestionId: row.id, action: 'reject' as const })),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(service.confirmQueueSize()).toBe(0);
  });

  it('flags a suggestion with no confidence as low confidence', () => {
    const service = serviceWith({
      extractor: {
        extract: () => ({
          outcome: 'suggested',
          suggestions: [
            {
              targetEntityType: 'obligation',
              fieldPath: 'providerName',
              suggestedValue: 'Predial Coyoacán',
            },
          ],
        }),
      },
    });
    const suggestions = suggestionMap(service, PROPERTY, service.enqueue(PROPERTY, DOCUMENT).job.id);
    expect(suggestions[0]?.confidence).toBeNull();
    expect(suggestions[0]?.lowConfidence).toBe(true);
    expect(suggestions[0]?.applyStatus).toBe('pending');
  });

  it('expires a job for confirm with 410 and drops it only to make room', async () => {
    const clock = new ManualClock(1_000);
    const service = serviceWith({ clock, jobTtlMs: 500, jobsMax: 1 });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const payload = suggestionMap(service, PROPERTY, job.id).map((row) => ({
      suggestionId: row.id,
      action: 'reject' as const,
    }));
    clock.nowMs = 1_500;
    await expect(service.confirm(PROPERTY, job.id, payload)).rejects.toMatchObject({
      response: { error: 'job_expired', message: 'OCR job has expired.', statusCode: 410 },
    });
    expect(() => service.getJob(PROPERTY, job.id)).toThrow(GoneException);
    try {
      service.getJob(PROPERTY, job.id);
      expect.unreachable();
    } catch (error) {
      expect((error as GoneException).getResponse()).toMatchObject({ error: 'job_expired' });
    }

    clock.nowMs = 1_600;
    const created = service.enqueue(PROPERTY, DOCUMENT_2);
    expect(created.created).toBe(true);
    expect(() => service.getJob(PROPERTY, job.id)).toThrow(NotFoundException);
  });

  it('rejects prototype keys on a confirm payload', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const payload = JSON.parse(
      '{"__proto__":{"admin":true},"decisions":[{"suggestionId":"11111111-1111-4111-8111-111111111111","action":"reject","constructor":{"x":1}}]}',
    ) as unknown;
    await expect(service.confirm(PROPERTY, job.id, payload)).rejects.toMatchObject({
      response: { error: 'unknown_field', statusCode: 400 },
    });
    expect(Object.prototype).not.toHaveProperty('admin');
    expect(
      suggestionMap(service, PROPERTY, job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);
  });

  it('flags 0.79 and a missing score as revisa and keeps 0.80 as media', () => {
    const service = serviceWith({
      extractor: {
        extract: () => ({
          outcome: 'suggested',
          suggestions: [
            { targetEntityType: 'obligation', fieldPath: 'providerName', suggestedValue: 'A', confidence: 0.79 },
            { targetEntityType: 'obligation', fieldPath: 'expectedAmount', suggestedValue: '10.00', confidence: 0.8 },
            { targetEntityType: 'document_meta', fieldPath: 'title', suggestedValue: 'Titulo', confidence: 0.9 },
            { targetEntityType: 'obligation', fieldPath: 'providerName', suggestedValue: 'B' },
          ],
        }),
      },
    });
    const suggestions = suggestionMap(service, PROPERTY, service.enqueue(PROPERTY, DOCUMENT).job.id);
    const low = suggestions.find((row) => row.suggestedValue === 'A');
    const boundary = suggestions.find((row) => row.fieldPath === 'expectedAmount');
    const alta = suggestions.find((row) => row.fieldPath === 'title');
    const missing = suggestions.find((row) => row.suggestedValue === 'B');
    expect(low).toMatchObject({ band: 'revisa', lowConfidence: true });
    expect(boundary).toMatchObject({ band: 'media', lowConfidence: false });
    expect(alta).toMatchObject({ band: 'alta', lowConfidence: false });
    expect(missing).toMatchObject({ band: 'revisa', lowConfidence: true, confidence: null });
  });

  it('does not treat 1,234 as a confident amount', () => {
    const service = serviceWith({
      extractor: {
        extract: () => ({
          outcome: 'suggested',
          suggestions: [
            {
              targetEntityType: 'obligation',
              fieldPath: 'expectedAmount',
              suggestedValue: '1,234',
              confidence: 0.95,
            },
          ],
        }),
      },
    });
    const [row] = suggestionMap(service, PROPERTY, service.enqueue(PROPERTY, DOCUMENT).job.id);
    expect(row?.band).toBe('revisa');
    expect(row?.lowConfidence).toBe(true);
    expect(row?.suggestedValue).toBe('1,234');
  });

  it('marks out-of-range and non-numeric scores as revisa', () => {
    const service = serviceWith({
      extractor: {
        extract: () => ({
          outcome: 'suggested',
          suggestions: [
            { targetEntityType: 'obligation', fieldPath: 'providerName', suggestedValue: 'High', confidence: 1.2 },
            { targetEntityType: 'obligation', fieldPath: 'providerName', suggestedValue: 'Low', confidence: -0.1 },
            { targetEntityType: 'obligation', fieldPath: 'providerName', suggestedValue: 'Nan', confidence: Number.NaN },
            { targetEntityType: 'obligation', fieldPath: 'providerName', suggestedValue: 'Text', confidence: 'high' },
          ],
        }),
      },
    });
    const suggestions = suggestionMap(service, PROPERTY, service.enqueue(PROPERTY, DOCUMENT).job.id);
    expect(suggestions.find((row) => row.suggestedValue === 'High')).toMatchObject({
      band: 'revisa',
      lowConfidence: true,
      confidence: 1.2,
    });
    expect(suggestions.find((row) => row.suggestedValue === 'Low')).toMatchObject({
      band: 'revisa',
      lowConfidence: true,
      confidence: -0.1,
    });
    expect(suggestions.find((row) => row.suggestedValue === 'Nan')).toMatchObject({
      band: 'revisa',
      lowConfidence: true,
      confidence: null,
    });
    expect(suggestions.find((row) => row.suggestedValue === 'Text')).toMatchObject({
      band: 'revisa',
      lowConfidence: true,
      confidence: null,
    });
  });

  it('uses configured confidence band thresholds', () => {
    expect(loadOcrRuntime({ OCR_CONFIDENCE_ALTA: '0.95', OCR_CONFIDENCE_MEDIA: '0.70' }).confidenceBands).toEqual({
      alta: 0.95,
      media: 0.7,
    });
    expect(loadOcrRuntime({ OCR_CONFIDENCE_ALTA: 'nope' }).confidenceBands).toEqual({ alta: 0.9, media: 0.8 });
    const service = serviceWith({
      confidenceBands: { alta: 0.95, media: 0.7 },
      extractor: {
        extract: () => ({
          outcome: 'suggested',
          suggestions: [
            { targetEntityType: 'obligation', fieldPath: 'providerName', suggestedValue: 'Alta', confidence: 0.96 },
            { targetEntityType: 'obligation', fieldPath: 'providerName', suggestedValue: 'Media', confidence: 0.9 },
            { targetEntityType: 'obligation', fieldPath: 'providerName', suggestedValue: 'Revisa', confidence: 0.69 },
            {
              targetEntityType: 'obligation',
              fieldPath: 'expectedAmount',
              suggestedValue: '1,234',
              confidence: 0.99,
            },
          ],
        }),
      },
    });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    expect(job.confidenceBands).toEqual({ alta: 0.95, media: 0.7 });
    expect(suggestions.find((row) => row.suggestedValue === 'Alta')?.band).toBe('alta');
    expect(suggestions.find((row) => row.suggestedValue === 'Media')?.band).toBe('media');
    expect(suggestions.find((row) => row.suggestedValue === 'Revisa')?.band).toBe('revisa');
    expect(suggestions.find((row) => row.fieldPath === 'expectedAmount')).toMatchObject({
      band: 'revisa',
      lowConfidence: true,
    });
  });

  it('rejects forbidden text instead of stripping it', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const samples = ['\u0001', '\u0085', '\u202E', '\u2068', '\u200B', '\u200D', '\uFEFF', '\u2060'];
    for (const sample of samples) {
      const dirty = `Cafe${sample}x`;
      await expect(
        service.confirm(
          PROPERTY,
          job.id,
          suggestions.map((row) =>
            row.fieldPath === 'providerName'
              ? { suggestionId: row.id, action: 'edit' as const, editedValue: dirty, targetEntityId: OBLIGATION }
              : { suggestionId: row.id, action: 'reject' as const },
          ),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      const provider = suggestionMap(service, PROPERTY, job.id).find((row) => row.fieldPath === 'providerName');
      expect(provider?.applyStatus).toBe('pending');
      expect(provider?.userEditedValue).toBeNull();
      expect(provider?.suggestedValue).toBe('BBVA Hipoteca');
      expect(JSON.stringify(provider)).not.toContain(sample);
    }
  });

  it('returns 422 for a nextDueDate outside the property-timezone window', async () => {
    const clock = new ManualClock(Date.parse('2026-10-21T18:00:00.000Z'));
    const service = serviceWith({ clock });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const beyond = suggestions.map((row) =>
      row.fieldPath === 'nextDueDate'
        ? { suggestionId: row.id, action: 'edit' as const, editedValue: '2031-10-22', targetEntityId: OBLIGATION }
        : { suggestionId: row.id, action: 'reject' as const },
    );
    await expect(service.confirm(PROPERTY, job.id, beyond)).rejects.toBeInstanceOf(UnprocessableEntityException);
    try {
      await service.confirm(PROPERTY, job.id, beyond);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getStatus()).toBe(422);
      const due = suggestions.find((row) => row.fieldPath === 'nextDueDate');
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        error: 'next_due_date_out_of_range',
        suggestionId: due?.id,
        field: 'nextDueDate',
      });
      expect(NEXT_DUE_DATE_ERROR).toBe('next_due_date_out_of_range');
    }
  });

  it('returns 409 field_already_set for accept or edit of a saved value, and replace audits it', async () => {
    const saved = new Map<string, unknown>([['providerName', 'BBVA ya capturado']]);
    const base = lookup();
    const service = serviceWith({
      lookup: {
        belongsToProperty: (input) => base.belongsToProperty(input),
        savedValue({ fieldPath }) {
          return saved.has(fieldPath) ? saved.get(fieldPath) : undefined;
        },
        saveValue({ fieldPath }, value) {
          saved.set(fieldPath, value);
        },
      },
    });
    const first = service.enqueue(PROPERTY, DOCUMENT);
    const firstSuggestions = suggestionMap(service, PROPERTY, first.job.id);
    const firstProvider = firstSuggestions.find((row) => row.fieldPath === 'providerName');
    const acceptBody = firstSuggestions.map((row) =>
      row.id === firstProvider?.id
        ? { suggestionId: row.id, action: 'accept' as const, targetEntityId: OBLIGATION }
        : { suggestionId: row.id, action: 'reject' as const },
    );
    await expect(service.confirm(PROPERTY, first.job.id, acceptBody, { actorUserId: 'user-a' })).rejects.toMatchObject({
      response: {
        statusCode: 409,
        error: 'field_already_set',
        suggestionId: firstProvider?.id,
        field: 'providerName',
      },
    });
    const editBody = firstSuggestions.map((row) =>
      row.id === firstProvider?.id
        ? { suggestionId: row.id, action: 'edit' as const, editedValue: 'Otro', targetEntityId: OBLIGATION }
        : { suggestionId: row.id, action: 'reject' as const },
    );
    await expect(service.confirm(PROPERTY, first.job.id, editBody)).rejects.toMatchObject({
      response: { statusCode: 409, error: 'field_already_set', field: 'providerName' },
    });
    expect(saved.get('providerName')).toBe('BBVA ya capturado');
    expect(service.getJob(PROPERTY, first.job.id).job.status).toBe('suggested');
    expect(
      suggestionMap(service, PROPERTY, first.job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);

    const second = service.enqueue(PROPERTY, DOCUMENT_2);
    const secondSuggestions = suggestionMap(service, PROPERTY, second.job.id);
    const provider = secondSuggestions.find((row) => row.fieldPath === 'providerName');
    const replaced = await service.confirm(
      PROPERTY,
      second.job.id,
      secondSuggestions.map((row) =>
        row.id === provider?.id
          ? { suggestionId: row.id, action: 'replace' as const, editedValue: 'Otro banco', targetEntityId: OBLIGATION }
          : { suggestionId: row.id, action: 'reject' as const },
      ),
      { actorUserId: 'user-a' },
    );
    expect(saved.get('providerName')).toBe('Otro banco');
    expect(replaced.audits).toEqual([
      {
        suggestionId: provider?.id,
        field: 'providerName',
        action: 'replace',
        actorUserId: 'user-a',
        previousValue: 'BBVA ya capturado',
        newValue: 'Otro banco',
      },
    ]);
    expect(paymentCreateAuditFromReplace(replaced.audits[0]!)).toEqual({
      source: 'ocr_replace',
      suggestionId: provider?.id,
      field: 'providerName',
    });
    expect(replaced.persisted).toBe(true);
  });

  it('rolls back the first saved field when the second write fails', async () => {
    const saved = new Map<string, unknown>([
      ['expectedAmount', '10.00'],
      ['providerName', 'BBVA'],
    ]);
    const base = lookup();
    const service = serviceWith({
      lookup: {
        belongsToProperty: (input) => base.belongsToProperty(input),
        savedValue({ fieldPath }) {
          return saved.has(fieldPath) ? saved.get(fieldPath) : undefined;
        },
        saveValue({ fieldPath }, value) {
          if (value === null) {
            saved.delete(fieldPath);
            return;
          }
          if (fieldPath === 'providerName') {
            throw new Error('save failed');
          }
          saved.set(fieldPath, value);
        },
      },
    });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    await expect(
      service.confirm(
        PROPERTY,
        job.id,
        suggestions.map((row) => {
          if (row.fieldPath === 'expectedAmount') {
            return {
              suggestionId: row.id,
              action: 'replace' as const,
              editedValue: '20.00',
              targetEntityId: OBLIGATION,
            };
          }
          if (row.fieldPath === 'providerName') {
            return {
              suggestionId: row.id,
              action: 'replace' as const,
              editedValue: 'Otro banco',
              targetEntityId: OBLIGATION,
            };
          }
          return { suggestionId: row.id, action: 'reject' as const };
        }),
      ),
    ).rejects.toThrow('save failed');
    expect(saved.get('expectedAmount')).toBe('10.00');
    expect(saved.get('providerName')).toBe('BBVA');
    expect(service.getJob(PROPERTY, job.id).job.status).toBe('suggested');
    expect(
      suggestionMap(service, PROPERTY, job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);
  });

  it('returns 422 when a payment target has no paymentStatus', async () => {
    const service = serviceWith({
      lookup: {
        belongsToProperty({ entityType, entityId }) {
          if (entityType === 'payment') return entityId === PAYMENT;
          if (entityType === 'document_meta') return entityId === DOCUMENT;
          return false;
        },
      },
      extractor: {
        extract: () => ({
          outcome: 'suggested',
          suggestions: [
            {
              targetEntityType: 'payment',
              fieldPath: 'expectedAmount',
              suggestedValue: '100.00',
              confidence: 0.95,
            },
          ],
        }),
      },
    });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const [row] = suggestionMap(service, PROPERTY, job.id);
    await expect(
      service.confirm(PROPERTY, job.id, [
        { suggestionId: row?.id ?? '', action: 'accept', targetEntityId: PAYMENT },
      ]),
    ).rejects.toMatchObject({
      response: { error: 'target_status_unknown', statusCode: 422 },
    });
    const unchecked = serviceWith({
      lookup: {
        belongsToProperty({ entityType, entityId }) {
          if (entityType === 'payment') return entityId === PAYMENT;
          return false;
        },
        paymentStatus() {
          return 'scheduled';
        },
      },
      extractor: {
        extract: () => ({
          outcome: 'suggested',
          suggestions: [
            {
              targetEntityType: 'payment',
              fieldPath: 'expectedAmount',
              suggestedValue: '100.00',
              confidence: 0.95,
            },
          ],
        }),
      },
    });
    const uncheckedJob = unchecked.enqueue(PROPERTY, DOCUMENT_2).job;
    const [uncheckedRow] = suggestionMap(unchecked, PROPERTY, uncheckedJob.id);
    await expect(
      unchecked.confirm(PROPERTY, uncheckedJob.id, [
        { suggestionId: uncheckedRow?.id ?? '', action: 'accept', targetEntityId: PAYMENT },
      ]),
    ).rejects.toMatchObject({
      response: { error: 'target_status_unknown', message: 'A payment target must be checked before confirm.' },
    });
    expect(suggestionMap(service, PROPERTY, job.id)[0]?.applyStatus).toBe('pending');
  });

  it('returns 422 with the missing suggestionId', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const skipped = suggestions[0];
    expect(skipped).toBeDefined();
    try {
      await service.confirm(
        PROPERTY,
        job.id,
        suggestions.slice(1).map((row) => ({ suggestionId: row.id, action: 'reject' as const })),
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getStatus()).toBe(422);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        error: 'missing_decision',
        suggestionId: skipped?.id,
        statusCode: 422,
      });
    }
  });

  it('rejects a top-level clientPriorValue with 422', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const error = await service
      .confirm(PROPERTY, job.id, {
        clientPriorValue: 'typed in the form',
        decisions: suggestions.map((row) => ({ suggestionId: row.id, action: 'reject' })),
      })
      .then(
        () => {
          throw new Error('confirm resolved');
        },
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getStatus()).toBe(422);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      error: 'client_prior_value_rejected',
      statusCode: 422,
    });
    expect(error).not.toBeInstanceOf(BadRequestException);
  });

  it('returns 500 when the property timezone is invalid and leaves suggestions pending', async () => {
    const service = serviceWith({
      clock: new ManualClock(Date.parse('2026-10-21T18:00:00.000Z')),
      lookup: {
        belongsToProperty: (input) => lookup().belongsToProperty(input),
        timeZone() {
          return 'Not/AZone';
        },
      },
    });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const error = await service
      .confirm(
        PROPERTY,
        job.id,
        suggestions.map((row) =>
          row.fieldPath === 'nextDueDate'
            ? { suggestionId: row.id, action: 'edit' as const, editedValue: '2026-11-15', targetEntityId: OBLIGATION }
            : { suggestionId: row.id, action: 'reject' as const },
        ),
      )
      .then(
        () => {
          throw new Error('confirm resolved');
        },
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect((error as InternalServerErrorException).getStatus()).toBe(500);
    expect((error as InternalServerErrorException).getResponse()).toMatchObject({
      error: 'invalid_stored_timezone',
    });
    const after = suggestionMap(service, PROPERTY, job.id);
    expect(after.every((row) => row.applyStatus === 'pending')).toBe(true);
  });

  it('rejects C0 on single-line text and normalizes newlines on notes', async () => {
    const service = serviceWith({
      extractor: {
        extract: () => ({
          outcome: 'suggested',
          suggestions: [
            {
              targetEntityType: 'obligation',
              fieldPath: 'providerName',
              suggestedValue: 'BBVA',
              confidence: 0.95,
            },
            {
              targetEntityType: 'obligation',
              fieldPath: 'notes',
              suggestedValue: 'nota',
              confidence: 0.95,
            },
          ],
        }),
      },
    });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const body = (provider: string, notes: string) =>
      suggestions.map((row) => {
        if (row.fieldPath === 'providerName') {
          return { suggestionId: row.id, action: 'edit' as const, editedValue: provider, targetEntityId: OBLIGATION };
        }
        return { suggestionId: row.id, action: 'edit' as const, editedValue: notes, targetEntityId: OBLIGATION };
      });
    for (const sample of ['Cafe\t', 'Cafe\r', 'Cafe\n']) {
      await expect(service.confirm(PROPERTY, job.id, body(sample, 'nota'))).rejects.toMatchObject({
        response: { error: 'edited_value_invalid', field: 'providerName', statusCode: 422 },
      });
    }
    await expect(service.confirm(PROPERTY, job.id, body('BBVA', 'linea\t2'))).rejects.toMatchObject({
      response: { error: 'edited_value_invalid', field: 'notes', statusCode: 422 },
    });
    const result = await service.confirm(PROPERTY, job.id, body('BBVA', 'linea 1\r\nlinea 2'));
    expect(result.suggestions.find((row) => row.fieldPath === 'notes')?.userEditedValue).toBe('linea 1\nlinea 2');
    expect(
      suggestionMap(service, PROPERTY, job.id).find((row) => row.fieldPath === 'providerName')?.userEditedValue,
    ).toBe('BBVA');
  });

  it('records only the suggestion when replace happens before the record is saved', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const provider = suggestions.find((row) => row.fieldPath === 'providerName');
    const result = await service.confirm(
      PROPERTY,
      job.id,
      suggestions.map((row) =>
        row.id === provider?.id
          ? { suggestionId: row.id, action: 'replace' as const, targetEntityId: OBLIGATION }
          : { suggestionId: row.id, action: 'reject' as const },
      ),
      { actorUserId: 'user-a' },
    );
    expect(result.audits).toEqual([
      {
        suggestionId: provider?.id,
        field: 'providerName',
        decision: 'replaced',
        suggestedValue: 'BBVA Hipoteca',
      },
    ]);
    expect(result.audits[0]).not.toHaveProperty('previousValue');
    expect(result.audits[0]).not.toHaveProperty('clientPriorValue');
    expect(result.applied).toEqual([]);
    expect(result.persisted).toBe(false);
  });

  it('rejects clientPriorValue and a bulk accept-all with 422', async () => {
    const saved = new Map<string, unknown>([['providerName', 'BBVA ya capturado']]);
    const base = lookup();
    const service = serviceWith({
      lookup: {
        belongsToProperty: (input) => base.belongsToProperty(input),
        savedValue({ fieldPath }) {
          return saved.has(fieldPath) ? saved.get(fieldPath) : undefined;
        },
      },
    });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const provider = suggestions.find((row) => row.fieldPath === 'providerName');
    const withPrior = suggestions.map((row) =>
      row.id === provider?.id
        ? {
            suggestionId: row.id,
            action: 'replace' as const,
            editedValue: 'Otro',
            targetEntityId: OBLIGATION,
            clientPriorValue: 'typed in the form',
          }
        : { suggestionId: row.id, action: 'reject' as const },
    );
    await expect(service.confirm(PROPERTY, job.id, withPrior)).rejects.toMatchObject({
      response: { error: 'client_prior_value_rejected', statusCode: 422 },
    });
    expect(saved.get('providerName')).toBe('BBVA ya capturado');
    await expect(
      service.confirm(PROPERTY, job.id, { acceptAll: true, decisions: withPrior }),
    ).rejects.toMatchObject({ response: { error: 'bulk_accept_rejected', statusCode: 422 } });
    await expect(
      service.confirm(PROPERTY, job.id, { decisions: [{ action: 'accept-all' }] }),
    ).rejects.toMatchObject({ response: { error: 'bulk_accept_rejected', statusCode: 422 } });
    await expect(
      service.confirm(PROPERTY, job.id, { accept_all: true }),
    ).rejects.toMatchObject({ response: { error: 'bulk_accept_rejected', statusCode: 422 } });
    expect(
      suggestionMap(service, PROPERTY, job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);
  });

  it('keeps a saved value when the suggestion is rejected', async () => {
    const saved = new Map<string, unknown>([['providerName', 'BBVA ya capturado']]);
    const base = lookup();
    const service = serviceWith({
      lookup: {
        belongsToProperty: (input) => base.belongsToProperty(input),
        savedValue({ fieldPath }) {
          return saved.get(fieldPath);
        },
        saveValue({ fieldPath }, value) {
          saved.set(fieldPath, value);
        },
      },
    });
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    await service.confirm(
      PROPERTY,
      job.id,
      suggestions.map((row) => ({ suggestionId: row.id, action: 'reject' as const })),
    );
    expect(saved.get('providerName')).toBe('BBVA ya capturado');
  });

  it('stamps the remaining confirm parser codes', async () => {
    const service = serviceWith();
    const { job } = service.enqueue(PROPERTY, DOCUMENT);
    const suggestions = suggestionMap(service, PROPERTY, job.id);
    const first = suggestions[0];
    expect(first).toBeDefined();
    const rejectRest = suggestions.map((row) => ({ suggestionId: row.id, action: 'reject' as const }));

    await expect(service.confirm(PROPERTY, job.id, [])).rejects.toMatchObject({
      response: { error: 'decisions_invalid', statusCode: 400 },
    });
    await expect(service.confirm(PROPERTY, job.id, 'nope')).rejects.toMatchObject({
      response: { error: 'decisions_invalid', statusCode: 400 },
    });
    await expect(service.confirm(PROPERTY, job.id, { decisions: 'nope' })).rejects.toMatchObject({
      response: { error: 'decisions_invalid', statusCode: 400 },
    });
    await expect(service.confirm(PROPERTY, job.id, { decisions: [null] })).rejects.toMatchObject({
      response: { error: 'suggestion_invalid', statusCode: 400 },
    });
    await expect(
      service.confirm(PROPERTY, job.id, { decisions: [{ suggestionId: 'not-a-uuid', action: 'reject' }] }),
    ).rejects.toMatchObject({ response: { error: 'suggestion_invalid', statusCode: 400 } });
    await expect(
      service.confirm(PROPERTY, job.id, {
        decisions: [{ suggestionId: first?.id, action: 'keep' }],
      }),
    ).rejects.toMatchObject({ response: { error: 'action_invalid', statusCode: 400 } });
    await expect(
      service.confirm(PROPERTY, job.id, {
        decisions: [{ suggestionId: first?.id, action: 'edit' }],
      }),
    ).rejects.toMatchObject({ response: { error: 'edited_value_required', statusCode: 400 } });
    await expect(
      service.confirm(PROPERTY, job.id, {
        decisions: [rejectRest[0], rejectRest[0]],
      }),
    ).rejects.toMatchObject({ response: { error: 'duplicate_decision', statusCode: 400 } });
    const nested: Record<string, unknown> = { decisions: [] };
    let cursor = nested;
    for (let depth = 0; depth < 25; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    await expect(service.confirm(PROPERTY, job.id, nested)).rejects.toMatchObject({
      response: { error: 'decisions_invalid', statusCode: 400 },
    });
    await expect(
      service.confirm(PROPERTY, job.id, { extra: true, decisions: rejectRest }),
    ).rejects.toMatchObject({ response: { error: 'unknown_field', statusCode: 400 } });
  });

  it('exposes no obligation or payment writer on the service', () => {
    const names = Object.getOwnPropertyNames(OcrService.prototype);
    expect(names).not.toContain('applyToObligation');
    expect(names).not.toContain('createPayment');
    expect(names).toContain('confirm');
  });
});
