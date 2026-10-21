import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PROPERTY_TIMEZONE } from '../common/property-calendar.js';
import { isTraversal, isUuid } from '../common/path-safety.js';
import { CLOCK, SystemClock, type Clock } from './clock.js';
import { parseDecisions } from './ocr-decisions.js';
import { OCR_EXTRACTOR, StubOcrExtractor, type ExtractedField, type OcrExtractor } from './ocr-extractor.js';
import {
  CONFIDENCE_BANDS,
  LOW_CONFIDENCE_THRESHOLD,
  canonicalizeFieldValue,
  confidenceBand,
} from './ocr-fields.js';
import { parseMxAmount, parseMxDate } from './ocr-locale.js';
import { OCR_RUNTIME, loadOcrRuntime, type OcrRuntime } from './ocr-runtime.js';
import { FailClosedOcrTargetLookup, OCR_TARGET_LOOKUP, type OcrTargetLookup } from './ocr-target-lookup.js';
import type {
  OcrAppliedField,
  OcrConfirmResult,
  OcrDecision,
  OcrJob,
  OcrReplaceAudit,
  OcrSuggestion,
} from './ocr.types.js';
import { OBJECT_STORAGE, PrivateObjectStorage, type ObjectStorage } from './object-storage.js';

interface JobRecord {
  job: OcrJob;
  /** Private. Never copied onto a response. */
  storageKey: string;
  suggestions: OcrSuggestion[];
  expiresAt: number;
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
  private readonly tails = new Map<string, Promise<void>>();
  private readonly runtime: OcrRuntime;
  private readonly lookup: OcrTargetLookup;
  private readonly clock: Clock;
  private readonly extractor: OcrExtractor;
  private readonly storage: ObjectStorage;

  constructor(
    @Optional() @Inject(OCR_RUNTIME) runtime?: OcrRuntime,
    @Optional() @Inject(OCR_TARGET_LOOKUP) lookup?: OcrTargetLookup,
    @Optional() @Inject(CLOCK) clock?: Clock,
    @Optional() @Inject(OCR_EXTRACTOR) extractor?: OcrExtractor,
    @Optional() @Inject(OBJECT_STORAGE) storage?: ObjectStorage,
  ) {
    this.runtime = runtime ?? loadOcrRuntime();
    this.lookup = lookup ?? new FailClosedOcrTargetLookup();
    this.clock = clock ?? new SystemClock();
    this.extractor = extractor ?? new StubOcrExtractor();
    this.storage = storage ?? new PrivateObjectStorage();
  }

  enqueue(propertyId: string, documentId: string): { job: OcrJob; created: boolean } {
    assertUuidPair(propertyId, documentId);
    const existing = this.findOpen(propertyId, documentId);
    if (existing && existing.expiresAt > this.clock.now()) {
      return { job: this.toPublicJob(existing.job), created: false };
    }

    this.dropExpired();
    const globalMax = this.runtime.jobsGlobalMax ?? this.runtime.jobsMax * 20;
    if (this.capCount(propertyId) >= this.runtime.jobsMax || this.capCount() >= globalMax) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'OCR job capacity is full.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const storageKey = this.storage.buildOcrSourceKey(propertyId, documentId);
    const now = new Date(this.clock.now()).toISOString();
    const id = randomUUID();
    const record: JobRecord = {
      job: {
        id,
        propertyId,
        documentId,
        status: 'pending',
        confidenceBands: CONFIDENCE_BANDS,
        createdAt: now,
        updatedAt: now,
      },
      storageKey,
      suggestions: [],
      expiresAt: this.clock.now() + this.runtime.jobTtlMs,
    };
    this.finishExtract(record);
    this.jobs.set(id, record);
    return { job: this.toPublicJob(record.job), created: true };
  }

  getJob(propertyId: string, ocrJobId: string): { job: OcrJob; suggestions: OcrSuggestion[] } {
    assertUuidPair(propertyId, ocrJobId);
    return this.snapshot(this.requireFresh(propertyId, ocrJobId));
  }

  listForDocument(propertyId: string, documentId: string): OcrJob[] {
    assertUuidPair(propertyId, documentId);
    const now = this.clock.now();
    return [...this.jobs.values()]
      .filter(
        (record) =>
          record.job.propertyId === propertyId &&
          record.job.documentId === documentId &&
          record.expiresAt > now,
      )
      .sort((left, right) => right.job.createdAt.localeCompare(left.job.createdAt))
      .map((record) => this.toPublicJob(record.job));
  }

  confirm(
    propertyId: string,
    ocrJobId: string,
    input: unknown,
    options?: { actorUserId?: string | null },
  ): Promise<OcrConfirmResult> {
    assertUuidPair(propertyId, ocrJobId);
    const existing = this.jobs.get(ocrJobId);
    if (!existing || existing.job.propertyId !== propertyId) {
      throw new NotFoundException('Not found.');
    }
    return this.exclusive(ocrJobId, () =>
      this.confirmExclusive(propertyId, ocrJobId, input, options?.actorUserId ?? null),
    );
  }

  /** In-flight confirm chains. Tests assert this returns to 0 after the chain settles. */
  confirmQueueSize(): number {
    return this.tails.size;
  }

  private confirmExclusive(
    propertyId: string,
    ocrJobId: string,
    input: unknown,
    actorUserId: string | null,
  ): OcrConfirmResult {
    const record = this.requireFresh(propertyId, ocrJobId);
    if (record.job.status !== 'suggested') {
      throw new ConflictException('Only a job in status suggested can be confirmed.');
    }
    const decisions = parseDecisions(input);
    const plan = this.plan(record, decisions, actorUserId);

    const applied: OcrAppliedField[] = [];
    const audits: OcrReplaceAudit[] = [];
    for (const step of plan) {
      if (step.decision.action === 'reject' || !step.entityId) {
        step.suggestion.applyStatus = 'rejected';
        continue;
      }
      if (step.kept) {
        step.suggestion.applyStatus = 'accepted';
        if (step.decision.action === 'edit' || step.decision.action === 'replace') {
          step.suggestion.userEditedValue = step.value;
        }
        continue;
      }
      step.suggestion.targetEntityId = step.entityId;
      step.suggestion.applyStatus = 'accepted';
      if (step.decision.action === 'edit' || step.decision.action === 'replace') {
        step.suggestion.userEditedValue = step.value;
      }
      if (step.audit) {
        audits.push(step.audit);
      }
      if (step.write) {
        this.lookup.saveValue?.(
          {
            propertyId: record.job.propertyId,
            entityType: step.suggestion.targetEntityType,
            entityId: step.entityId,
            fieldPath: step.suggestion.fieldPath,
          },
          step.value,
        );
        applied.push({
          suggestionId: step.suggestion.id,
          entityType: step.suggestion.targetEntityType,
          entityId: step.entityId,
          fieldPath: step.suggestion.fieldPath,
        });
      }
    }

    const wroteOrDecided = plan.some((step) => step.decision.action !== 'reject' && step.entityId);
    record.job.status = wroteOrDecided ? 'confirmed' : 'rejected';
    record.job.updatedAt = new Date(this.clock.now()).toISOString();
    const snapshot = this.snapshot(record);
    return {
      job: snapshot.job,
      suggestions: snapshot.suggestions,
      applied,
      audits,
      persisted: false,
    };
  }

  private plan(
    record: JobRecord,
    decisions: OcrDecision[],
    actorUserId: string | null,
  ): Array<{
    suggestion: OcrSuggestion;
    decision: OcrDecision;
    entityId?: string;
    value?: unknown;
    kept?: boolean;
    write?: boolean;
    audit?: OcrReplaceAudit;
  }> {
    const known = new Map(record.suggestions.map((suggestion) => [suggestion.id, suggestion]));
    const seen = new Set<string>();
    for (const decision of decisions) {
      if (!known.has(decision.suggestionId)) {
        throw new NotFoundException('Not found.');
      }
      if (seen.has(decision.suggestionId)) {
        throw new BadRequestException('A suggestion is listed more than once.');
      }
      seen.add(decision.suggestionId);
    }
    const missing = record.suggestions.filter((suggestion) => !seen.has(suggestion.id));
    if (missing.length > 0) {
      throw new UnprocessableEntityException(
        'Every suggestion needs an explicit accept, replace, reject, or edit.',
      );
    }

    const steps: Array<{
      suggestion: OcrSuggestion;
      decision: OcrDecision;
      entityId?: string;
      value?: unknown;
      kept?: boolean;
      write?: boolean;
      audit?: OcrReplaceAudit;
    }> = [];
    const context = {
      now: new Date(this.clock.now()),
      timeZone: this.lookup.timeZone?.(record.job.propertyId) ?? DEFAULT_PROPERTY_TIMEZONE,
    };
    for (const decision of decisions) {
      const suggestion = known.get(decision.suggestionId);
      if (!suggestion) {
        throw new NotFoundException('Not found.');
      }
      if (decision.action === 'reject') {
        steps.push({ suggestion, decision });
        continue;
      }
      const entityId = this.resolveTarget(record, suggestion, decision);
      const rawValue =
        decision.action === 'edit' || (decision.action === 'replace' && decision.editedValue !== undefined)
          ? decision.editedValue
          : suggestion.suggestedValue;
      const value = this.canonicalize(suggestion, rawValue, context);
      const saved = this.readSaved(record.job.propertyId, suggestion, entityId);
      if (saved.present && decision.action !== 'replace') {
        steps.push({ suggestion, decision, entityId, value, kept: true });
        continue;
      }
      if (decision.action === 'replace') {
        const audit: OcrReplaceAudit = saved.present
          ? {
              suggestionId: suggestion.id,
              field: suggestion.fieldPath,
              action: 'replace',
              actorUserId,
              previousValue: saved.value,
              newValue: value,
            }
          : {
              suggestionId: suggestion.id,
              field: suggestion.fieldPath,
              decision: 'replaced',
              suggestedValue: value,
            };
        steps.push({ suggestion, decision, entityId, value, write: saved.present, audit });
        continue;
      }
      steps.push({ suggestion, decision, entityId, value, write: true });
    }
    return steps;
  }

  private readSaved(
    propertyId: string,
    suggestion: OcrSuggestion,
    entityId: string,
  ): { present: false } | { present: true; value: unknown } {
    if (!this.lookup.savedValue) {
      return { present: false };
    }
    const value = this.lookup.savedValue({
      propertyId,
      entityType: suggestion.targetEntityType,
      entityId,
      fieldPath: suggestion.fieldPath,
    });
    if (value === undefined || value === null) {
      return { present: false };
    }
    return { present: true, value };
  }

  private canonicalize(
    suggestion: OcrSuggestion,
    rawValue: unknown,
    context: { now: Date; timeZone: string },
  ): unknown {
    try {
      return canonicalizeFieldValue(
        suggestion.fieldPath,
        suggestion.targetEntityType,
        rawValue,
        context,
      );
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        throw namedSuggestion(error, suggestion);
      }
      throw error;
    }
  }

  private resolveTarget(record: JobRecord, suggestion: OcrSuggestion, decision: OcrDecision): string {
    const requested = decision.targetEntityId;
    const bound = suggestion.targetEntityId;
    if (bound && requested !== undefined && requested !== bound) {
      if (!isUuid(requested)) {
        throw new BadRequestException('targetEntityId must be a UUID.');
      }
      if (!this.targetBelongs(record, suggestion, requested)) {
        throw new NotFoundException('Not found.');
      }
      throw new UnprocessableEntityException('A bound target cannot be changed.');
    }
    const entityId = requested ?? bound;
    if (!entityId) {
      throw new UnprocessableEntityException(
        'A suggestion needs targetEntityId before it can be accepted.',
      );
    }
    if (!isUuid(entityId)) {
      throw new BadRequestException('targetEntityId must be a UUID.');
    }
    if (!this.targetBelongs(record, suggestion, entityId)) {
      throw new NotFoundException('Not found.');
    }
    if (
      suggestion.targetEntityType === 'payment' &&
      this.lookup.paymentStatus?.({ propertyId: record.job.propertyId, entityId }) === 'voided'
    ) {
      throw new UnprocessableEntityException('A voided payment cannot be a confirm target.');
    }
    return entityId;
  }

  private targetBelongs(record: JobRecord, suggestion: OcrSuggestion, entityId: string): boolean {
    return this.lookup.belongsToProperty({
      propertyId: record.job.propertyId,
      entityType: suggestion.targetEntityType,
      entityId,
    });
  }

  /**
   * Stub worker. Stops at `suggested` with applyStatus still `pending`
   * unless the extractor reports failed, pending, or processing.
   * Does not call confirm().
   */
  private finishExtract(record: JobRecord): void {
    record.job.status = 'processing';
    record.job.updatedAt = new Date(this.clock.now()).toISOString();
    const extracted = this.extractor.extract({
      propertyId: record.job.propertyId,
      documentId: record.job.documentId,
    });
    record.job.vendor = 'stub';
    if (extracted.outcome === 'failed') {
      record.job.status = 'failed';
      record.job.errorCode = 'extract_failed';
      record.suggestions = [];
      record.job.updatedAt = new Date(this.clock.now()).toISOString();
      return;
    }
    if (extracted.outcome === 'pending' || extracted.outcome === 'processing') {
      record.job.status = extracted.outcome;
      record.suggestions = [];
      record.job.updatedAt = new Date(this.clock.now()).toISOString();
      return;
    }
    record.suggestions = (extracted.suggestions ?? []).map((field) =>
      this.toSuggestion(record, field),
    );
    record.job.status = 'suggested';
    record.job.updatedAt = new Date(this.clock.now()).toISOString();
  }

  private toSuggestion(record: JobRecord, field: ExtractedField): OcrSuggestion {
    const confidence = readConfidence(field.confidence);
    const targetEntityId =
      field.targetEntityType === 'document_meta'
        ? record.job.documentId
        : field.targetEntityId;
    return {
      id: randomUUID(),
      ocrJobId: record.job.id,
      targetEntityType: field.targetEntityType,
      targetEntityId,
      fieldPath: field.fieldPath,
      suggestedValue: field.suggestedValue,
      confidence,
      band: confidenceBand(confidence),
      lowConfidence: isLowConfidence(field.fieldPath, field.suggestedValue, confidence),
      userEditedValue: null,
      applyStatus: 'pending',
    };
  }

  private findOpen(propertyId: string, documentId: string): JobRecord | undefined {
    const now = this.clock.now();
    return [...this.jobs.values()].find(
      (record) =>
        record.job.propertyId === propertyId &&
        record.job.documentId === documentId &&
        OPEN_STATUSES.has(record.job.status) &&
        record.expiresAt > now,
    );
  }

  private dropExpired(): void {
    const now = this.clock.now();
    for (const [id, record] of this.jobs) {
      if (record.expiresAt <= now) {
        this.jobs.delete(id);
      }
    }
  }

  private requireFresh(propertyId: string, ocrJobId: string): JobRecord {
    const record = this.jobs.get(ocrJobId);
    if (!record || record.job.propertyId !== propertyId) {
      throw new NotFoundException('Not found.');
    }
    if (record.expiresAt <= this.clock.now()) {
      throw new GoneException('OCR job has expired.');
    }
    return record;
  }

  private snapshot(record: JobRecord): { job: OcrJob; suggestions: OcrSuggestion[] } {
    return {
      job: this.toPublicJob(record.job),
      suggestions: record.suggestions.map((suggestion) => ({ ...suggestion })),
    };
  }

  private toPublicJob(job: OcrJob): OcrJob {
    const publicJob: OcrJob = {
      id: job.id,
      propertyId: job.propertyId,
      documentId: job.documentId,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      confidenceBands: CONFIDENCE_BANDS,
    };
    if (job.evidenceId !== undefined) {
      publicJob.evidenceId = job.evidenceId;
    }
    if (job.vendor !== undefined) {
      publicJob.vendor = job.vendor;
    }
    if (job.errorCode !== undefined) {
      publicJob.errorCode = job.errorCode;
    }
    return publicJob;
  }

  private holdsCapSlot(record: JobRecord): boolean {
    return !(record.job.status === 'suggested' && record.suggestions.length === 0);
  }

  private capCount(propertyId?: string): number {
    let count = 0;
    for (const record of this.jobs.values()) {
      if (propertyId !== undefined && record.job.propertyId !== propertyId) {
        continue;
      }
      if (this.holdsCapSlot(record)) {
        count += 1;
      }
    }
    return count;
  }

  private exclusive<T>(key: string, fn: () => T): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.then(() => fn());
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, settled);
    void settled.then(() => {
      if (this.tails.get(key) === settled) {
        this.tails.delete(key);
      }
    });
    return run;
  }
}

function namedSuggestion(error: UnprocessableEntityException, suggestion: OcrSuggestion): UnprocessableEntityException {
  const response = error.getResponse();
  const body =
    typeof response === 'string'
      ? { statusCode: error.getStatus(), message: response }
      : { ...(response as Record<string, unknown>) };
  return new UnprocessableEntityException({
    ...body,
    suggestionId: suggestion.id,
    field: suggestion.fieldPath,
  });
}

function assertUuidPair(left: string, right: string): void {
  if (!isUuid(left) || !isUuid(right) || isTraversal(left) || isTraversal(right)) {
    throw new BadRequestException('Invalid path parameter.');
  }
}

function readConfidence(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function isLowConfidence(fieldPath: string, value: unknown, confidence: number | null): boolean {
  if (confidence === null || confidence < LOW_CONFIDENCE_THRESHOLD) {
    return true;
  }
  if (typeof value !== 'string') {
    return false;
  }
  if (fieldPath === 'expectedAmount') {
    return parseMxAmount(value)?.lowConfidence === true;
  }
  if (fieldPath === 'nextDueDate') {
    return parseMxDate(value)?.lowConfidence === true;
  }
  return false;
}
