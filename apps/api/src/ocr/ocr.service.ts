import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  OcrAppliedField,
  OcrConfirmResult,
  OcrDecision,
  OcrJob,
  OcrSuggestion,
  OcrTargetEntityType,
} from './ocr.types.js';

interface JobRecord {
  job: OcrJob;
  suggestions: OcrSuggestion[];
}

const OPEN_STATUSES = new Set(['pending', 'processing', 'suggested']);

/**
 * In-memory OCR stub. There is no model call and no database write.
 *
 * enqueue() moves a new job through pending and processing, stores
 * suggestions, and stops at `suggested`. Every suggestion stays `pending`.
 * confirm() is the only method that changes applyStatus.
 */
@Injectable()
export class OcrService {
  private readonly jobs = new Map<string, JobRecord>();

  enqueue(
    propertyId: string,
    documentId: string,
  ): { job: OcrJob; created: boolean } {
    const existing = [...this.jobs.values()].find(
      (record) =>
        record.job.propertyId === propertyId &&
        record.job.documentId === documentId &&
        OPEN_STATUSES.has(record.job.status),
    );
    if (existing) {
      return { job: this.copyJob(existing.job), created: false };
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const record: JobRecord = {
      job: {
        id,
        propertyId,
        documentId,
        status: 'pending',
        storageKey: `properties/${propertyId}/documents/${documentId}/ocr-stub`,
        createdAt: now,
        updatedAt: now,
      },
      suggestions: [],
    };
    this.finishExtract(record);
    this.jobs.set(id, record);
    return { job: this.copyJob(record.job), created: true };
  }

  getJob(
    propertyId: string,
    ocrJobId: string,
  ): { job: OcrJob; suggestions: OcrSuggestion[] } {
    const record = this.requireJob(propertyId, ocrJobId);
    return this.snapshot(record);
  }

  listForDocument(propertyId: string, documentId: string): OcrJob[] {
    return [...this.jobs.values()]
      .filter(
        (record) =>
          record.job.propertyId === propertyId &&
          record.job.documentId === documentId,
      )
      .sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt))
      .map((record) => this.copyJob(record.job));
  }

  confirm(
    propertyId: string,
    ocrJobId: string,
    decisions: OcrDecision[],
  ): OcrConfirmResult {
    const record = this.requireJob(propertyId, ocrJobId);
    if (record.job.status !== 'suggested') {
      throw new ConflictException(
        'Only a job in status suggested can be confirmed.',
      );
    }

    this.assertDecisions(record, decisions);

    const byId = new Map(decisions.map((decision) => [decision.suggestionId, decision]));
    const plan: Array<{
      suggestion: OcrSuggestion;
      decision: OcrDecision;
      entityId?: string;
    }> = [];

    for (const suggestion of record.suggestions) {
      const decision = byId.get(suggestion.id);
      if (!decision) {
        continue;
      }
      if (decision.action === 'reject') {
        plan.push({ suggestion, decision });
        continue;
      }
      const entityId = decision.targetEntityId ?? suggestion.targetEntityId;
      if (!entityId) {
        throw new UnprocessableEntityException(
          `Suggestion ${suggestion.id} needs targetEntityId before it can be accepted.`,
        );
      }
      plan.push({ suggestion, decision, entityId });
    }

    const applied: OcrAppliedField[] = [];
    for (const step of plan) {
      if (!step.entityId) {
        step.suggestion.applyStatus = 'rejected';
        continue;
      }
      step.suggestion.targetEntityId = step.entityId;
      step.suggestion.applyStatus = 'accepted';
      if (step.decision.action === 'edit') {
        step.suggestion.userEditedValue = step.decision.editedValue;
      }
      applied.push({
        suggestionId: step.suggestion.id,
        entityType: step.suggestion.targetEntityType,
        entityId: step.entityId,
        fieldPath: step.suggestion.fieldPath,
      });
    }

    record.job.status = applied.length > 0 ? 'confirmed' : 'rejected';
    record.job.updatedAt = new Date().toISOString();

    const snapshot = this.snapshot(record);
    return {
      job: snapshot.job,
      suggestions: snapshot.suggestions,
      applied,
      persisted: false,
    };
  }

  /**
   * Stub worker. Stops at `suggested` with applyStatus still `pending`.
   * Does not call confirm().
   */
  private finishExtract(record: JobRecord): void {
    record.job.status = 'processing';
    record.job.updatedAt = new Date().toISOString();
    record.suggestions = this.buildSuggestions(record.job.id, record.job.documentId);
    record.job.status = 'suggested';
    record.job.vendor = 'stub';
    record.job.updatedAt = new Date().toISOString();
  }

  private buildSuggestions(ocrJobId: string, documentId: string): OcrSuggestion[] {
    const rows: Array<{
      targetEntityType: OcrTargetEntityType;
      targetEntityId?: string;
      fieldPath: string;
      suggestedValue: unknown;
      confidence: number;
    }> = [
      {
        targetEntityType: 'obligation',
        fieldPath: 'expectedAmount',
        suggestedValue: { amount: '18450.00', currency: 'MXN' },
        confidence: 0.81,
      },
      {
        targetEntityType: 'obligation',
        fieldPath: 'nextDueDate',
        suggestedValue: '2026-11-15',
        confidence: 0.74,
      },
      {
        targetEntityType: 'obligation',
        fieldPath: 'providerName',
        suggestedValue: 'BBVA Hipoteca',
        confidence: 0.66,
      },
      {
        targetEntityType: 'document_meta',
        targetEntityId: documentId,
        fieldPath: 'title',
        suggestedValue: 'Hipoteca',
        confidence: 0.7,
      },
    ];

    return rows.map((row) => ({
      id: randomUUID(),
      ocrJobId,
      targetEntityType: row.targetEntityType,
      targetEntityId: row.targetEntityId,
      fieldPath: row.fieldPath,
      suggestedValue: row.suggestedValue,
      confidence: row.confidence,
      userEditedValue: null,
      applyStatus: 'pending',
    }));
  }

  private assertDecisions(record: JobRecord, decisions: OcrDecision[]): void {
    if (!Array.isArray(decisions) || decisions.length === 0) {
      throw new BadRequestException('decisions must be a non-empty array.');
    }

    const known = new Set(record.suggestions.map((suggestion) => suggestion.id));
    const seen = new Set<string>();
    for (const decision of decisions) {
      if (!decision || typeof decision.suggestionId !== 'string') {
        throw new BadRequestException('Each decision needs a suggestionId.');
      }
      if (!known.has(decision.suggestionId)) {
        throw new NotFoundException(
          `Suggestion ${decision.suggestionId} is not on this job.`,
        );
      }
      if (seen.has(decision.suggestionId)) {
        throw new BadRequestException(
          `Suggestion ${decision.suggestionId} is listed more than once.`,
        );
      }
      seen.add(decision.suggestionId);
      if (
        decision.action !== 'accept' &&
        decision.action !== 'reject' &&
        decision.action !== 'edit'
      ) {
        throw new BadRequestException(
          'action must be accept, reject, or edit.',
        );
      }
      if (decision.action === 'edit' && decision.editedValue === undefined) {
        throw new BadRequestException(
          `Suggestion ${decision.suggestionId} is an edit and needs editedValue.`,
        );
      }
    }

    const missing = record.suggestions.filter((suggestion) => !seen.has(suggestion.id));
    if (missing.length > 0) {
      throw new UnprocessableEntityException(
        'Every suggestion needs an explicit accept, reject, or edit.',
      );
    }
  }

  private requireJob(propertyId: string, ocrJobId: string): JobRecord {
    const record = this.jobs.get(ocrJobId);
    if (!record || record.job.propertyId !== propertyId) {
      throw new NotFoundException('OCR job not found.');
    }
    return record;
  }

  private snapshot(record: JobRecord): { job: OcrJob; suggestions: OcrSuggestion[] } {
    return {
      job: this.copyJob(record.job),
      suggestions: record.suggestions.map((suggestion) => ({ ...suggestion })),
    };
  }

  private copyJob(job: OcrJob): OcrJob {
    return { ...job };
  }
}
