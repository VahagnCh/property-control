import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { OcrService } from './ocr.service.js';

describe('OcrService', () => {
  function suggestionMap(service: OcrService, propertyId: string, jobId: string) {
    return service.getJob(propertyId, jobId).suggestions;
  }

  it('stops the stub worker at suggested and leaves every suggestion pending', () => {
    const service = new OcrService();
    const { job, created } = service.enqueue('property-1', 'document-1');

    expect(created).toBe(true);
    expect(job.status).toBe('suggested');
    expect(job.vendor).toBe('stub');
    expect(job.storageKey.startsWith('properties/')).toBe(true);
    expect(job.storageKey.includes('://')).toBe(false);

    const suggestions = suggestionMap(service, 'property-1', job.id);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((row) => row.applyStatus === 'pending')).toBe(true);
  });

  it('reuses an open job for the same document', () => {
    const service = new OcrService();
    const first = service.enqueue('property-1', 'document-1');
    const second = service.enqueue('property-1', 'document-1');

    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it('rejects a job when every suggestion is rejected and writes nothing', () => {
    const service = new OcrService();
    const { job } = service.enqueue('property-1', 'document-1');
    const suggestions = suggestionMap(service, 'property-1', job.id);

    const result = service.confirm(
      'property-1',
      job.id,
      suggestions.map((row) => ({ suggestionId: row.id, action: 'reject' as const })),
    );

    expect(result.job.status).toBe('rejected');
    expect(result.applied).toEqual([]);
    expect(result.persisted).toBe(false);
    expect(result.suggestions.every((row) => row.applyStatus === 'rejected')).toBe(true);
  });

  it('requires a target before accepting an unbound obligation field', () => {
    const service = new OcrService();
    const { job } = service.enqueue('property-1', 'document-1');
    const suggestions = suggestionMap(service, 'property-1', job.id);

    expect(() =>
      service.confirm(
        'property-1',
        job.id,
        suggestions.map((row) => ({ suggestionId: row.id, action: 'accept' as const })),
      ),
    ).toThrow(UnprocessableEntityException);

    expect(
      suggestionMap(service, 'property-1', job.id).every((row) => row.applyStatus === 'pending'),
    ).toBe(true);
  });

  it('records accept and edit only from confirm, without a persistence call', () => {
    const service = new OcrService();
    const { job } = service.enqueue('property-1', 'document-1');
    const suggestions = suggestionMap(service, 'property-1', job.id);
    const amount = suggestions.find((row) => row.fieldPath === 'expectedAmount');
    const due = suggestions.find((row) => row.fieldPath === 'nextDueDate');
    expect(amount).toBeDefined();
    expect(due).toBeDefined();

    const result = service.confirm(
      'property-1',
      job.id,
      suggestions.map((row) => {
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
      }),
    );

    expect(result.persisted).toBe(false);
    expect(result.job.status).toBe('confirmed');
    expect(result.applied.map((row) => row.fieldPath).sort()).toEqual([
      'expectedAmount',
      'nextDueDate',
      'providerName',
    ]);
    const edited = result.suggestions.find((row) => row.id === amount?.id);
    expect(edited?.applyStatus).toBe('accepted');
    expect(edited?.userEditedValue).toEqual({ amount: '19000.00', currency: 'MXN' });
    expect(() => service.confirm('property-1', job.id, [])).toThrow(ConflictException);
  });

  it('exposes no obligation or payment writer on the service', () => {
    const names = Object.getOwnPropertyNames(OcrService.prototype);
    expect(names).not.toContain('applyToObligation');
    expect(names).not.toContain('createPayment');
    expect(names).toContain('confirm');
  });
});
