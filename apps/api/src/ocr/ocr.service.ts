import { Inject, Injectable, Optional, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isTraversal, isUuid } from '../common/path-safety.js';
import { readStoredTimezone } from '../properties/property.response.js';
import { CLOCK, SystemClock, type Clock } from './clock.js';
import { parseDecisions } from './ocr-decisions.js';
import { OCR_EXTRACTOR, StubOcrExtractor, type ExtractedField, type OcrExtractor } from './ocr-extractor.js';
import { sealAuditText } from './audit-text.js';
import { canonicalizeFieldValue, confidenceBand } from './ocr-fields.js';
import { OCR_ERROR, ocrBadRequest, ocrCapacity, ocrConflict, ocrGone, ocrNotFound, ocrUnprocessable } from './ocr-errors.js';
import { parseMxAmount, parseMxDate } from './ocr-locale.js';
import {
  OCR_RUNTIME,
  loadOcrRuntime,
  resolveConfidenceBands,
  type OcrRuntime,
} from './ocr-runtime.js';
import { FailClosedOcrTargetLookup, OCR_TARGET_LOOKUP, type OcrTargetLookup } from './ocr-target-lookup.js';
import type {
  OcrAppliedField,
  OcrAppliedFieldAudit,
  OcrConfirmAudit,
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
  sourceKey: string;
  suggestions: OcrSuggestion[];
  expiresAt: number;
}

type SavedSnapshot = { present: false } | { present: true; value: unknown };

interface PlanStep {
  suggestion: OcrSuggestion;
  decision: OcrDecision;
  entityId?: string;
  value?: unknown;
  kept?: boolean;
  write?: boolean;
  audit?: OcrConfirmAudit;
  saved?: SavedSnapshot;
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
      throw ocrCapacity('OCR job capacity is full.');
    }

    const sourceKey = this.storage.buildOcrSourceKey();
    const now = new Date(this.clock.now()).toISOString();
    const id = randomUUID();
    const record: JobRecord = {
      job: {
        id,
        propertyId,
        documentId,
        status: 'pending',
        confidenceBands: resolveConfidenceBands(this.runtime),
        createdAt: now,
        updatedAt: now,
      },
      sourceKey,
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
throw ocrNotFound();
    }
    return this.exclusive(ocrJobId, () =>
      this.confirmExclusive(propertyId, ocrJobId, input, options?.actorUserId ?? null),
    );
  }

  /** In-flight confirm chains. Tests assert this returns to 0 after the chain settles. */
  confirmQueueSize(): number {
    return this.tails.size;
  }

  private async confirmExclusive(
    propertyId: string,
    ocrJobId: string,
    input: unknown,
    actorUserId: string | null,
  ): Promise<OcrConfirmResult> {
    const record = this.requireFresh(propertyId, ocrJobId);
    if (record.job.status !== 'suggested') {
      throw ocrConflict(OCR_ERROR.jobNotConfirmable, 'Only a job in status suggested can be confirmed.');
    }
    const decisions = parseDecisions(input);
    const plan = await this.plan(record, decisions, actorUserId);
    const persisted = await this.commitWrites(record, plan);

    const applied: OcrAppliedField[] = [];
    const audits: OcrConfirmAudit[] = [];
    for (const step of plan) {
      if (step.decision.action === 'reject' || !step.entityId) {
        step.suggestion.applyStatus = 'rejected';
        continue;
      }
      step.suggestion.targetEntityId = step.entityId;
      step.suggestion.applyStatus = 'accepted';
      if (step.decision.action === 'edit' || step.decision.action === 'replace') {
        step.suggestion.userEditedValue = step.value;
      }
      if (step.audit) {
        audits.push(sealAuditText(step.suggestion.fieldPath, step.audit).callerAudit);
      }
      if (step.write && step.entityId) {
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
      persisted,
    };
  }

  /**
   * Writes run only after plan() has validated every decision.
   * A failed save restores the fields this confirm already wrote.
   * When the lookup has runInTransaction, writes and audits share that transaction.
   * persisted is true only when those saves commit.
   */
  private async commitWrites(record: JobRecord, plan: PlanStep[]): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      const writes = plan.filter((step) => step.write && step.entityId);
      if (writes.length === 0 || !this.lookup.saveValue) {
        await this.appendAudits(record, plan);
        return false;
      }
      const committed: Array<{
        query: {
          propertyId: string;
          entityType: OcrSuggestion['targetEntityType'];
          entityId: string;
          fieldPath: string;
        };
        previous: SavedSnapshot;
      }> = [];
      try {
        for (const step of writes) {
          const entityId = step.entityId;
          if (!entityId) {
            continue;
          }
          const query = {
            propertyId: record.job.propertyId,
            entityType: step.suggestion.targetEntityType,
            entityId,
            fieldPath: step.suggestion.fieldPath,
          };
          const current = await this.readSaved(record.job.propertyId, step.suggestion, entityId);
          if (step.saved && !sameSaved(current, step.saved)) {
            throw ocrConflict(
              OCR_ERROR.savedValueConflict,
              'The saved value changed before confirm finished.',
            );
          }
          await this.lookup.saveValue(query, step.value);
          committed.push({ query, previous: current });
        }
        await this.appendAudits(record, plan);
      } catch (error) {
        for (const { query, previous } of committed.reverse()) {
          try {
            if (previous.present) {
              await this.lookup.saveValue?.(query, previous.value);
            } else {
              await this.lookup.saveValue?.(query, null);
            }
          } catch {
            // The original write error is the one confirm reports.
          }
        }
        throw error;
      }
      return true;
    };
    if (this.lookup.runInTransaction) {
      return this.lookup.runInTransaction(run);
    }
    return run();
  }

  private async plan(
    record: JobRecord,
    decisions: OcrDecision[],
    actorUserId: string | null,
  ): Promise<PlanStep[]> {
    const known = new Map(record.suggestions.map((suggestion) => [suggestion.id, suggestion]));
    const seen = new Set<string>();
    for (const decision of decisions) {
      if (!known.has(decision.suggestionId)) {
throw ocrNotFound();
      }
      if (seen.has(decision.suggestionId)) {
        throw ocrBadRequest(OCR_ERROR.duplicateDecision, 'A suggestion is listed more than once.');
      }
      seen.add(decision.suggestionId);
    }
    const missing = record.suggestions.filter((suggestion) => !seen.has(suggestion.id));
    if (missing.length > 0) {
      const suggestionId = missing[0]?.id;
      throw ocrUnprocessable(
        OCR_ERROR.missingDecision,
        'Every suggestion needs an explicit accept, replace, reject, or edit.',
        { suggestionId },
      );
    }

    const steps: PlanStep[] = [];
    const context = {
      now: new Date(this.clock.now()),
      timeZone: await this.propertyTimeZone(record.job.propertyId),
    };
    for (const decision of decisions) {
      const suggestion = known.get(decision.suggestionId);
      if (!suggestion) {
throw ocrNotFound();
      }
      if (decision.action === 'reject') {
        steps.push({ suggestion, decision });
        continue;
      }
      const entityId = await this.resolveTarget(record, suggestion, decision);
      const rawValue =
        decision.action === 'edit' || (decision.action === 'replace' && decision.editedValue !== undefined)
          ? decision.editedValue
          : suggestion.suggestedValue;
      const value = this.canonicalize(suggestion, rawValue, context);
      const saved = await this.readSaved(record.job.propertyId, suggestion, entityId);
      if (saved.present && decision.action !== 'replace') {
        throw ocrConflict(OCR_ERROR.fieldAlreadySet, 'The field already has a saved value.', {
          suggestionId: suggestion.id,
          field: suggestion.fieldPath,
        });
      }
      if (!persistableTarget(suggestion.targetEntityType)) {
        throw ocrUnprocessable(
          OCR_ERROR.targetNotWritable,
          'This confirm target cannot be saved yet.',
          { suggestionId: suggestion.id, field: suggestion.fieldPath },
        );
      }
      if (decision.action === 'replace') {
        // EC-9.2: only saved state is audited. An unsaved Reemplazar writes no row.
        if (!saved.present) {
          steps.push({ suggestion, decision, entityId, value, write: false, saved });
          continue;
        }
        const audit: OcrReplaceAudit = {
          suggestionId: suggestion.id,
          field: suggestion.fieldPath,
          action: 'replace',
          actorUserId,
          previousValue: saved.value,
          newValue: value,
        };
        steps.push({ suggestion, decision, entityId, value, write: true, audit, saved });
        continue;
      }
      const appliedAudit: OcrAppliedFieldAudit = {
        source: 'ocr',
        ocrJobId: suggestion.ocrJobId,
        suggestionId: suggestion.id,
        field: suggestion.fieldPath,
        actorUserId,
        confidence: suggestion.confidence ?? null,
        edited: decision.action === 'edit',
        previousValue: null,
        newValue: value,
      };
      steps.push({ suggestion, decision, entityId, value, write: true, audit: appliedAudit, saved });
    }
    return steps;
  }

  private async readSaved(
    propertyId: string,
    suggestion: OcrSuggestion,
    entityId: string,
  ): Promise<SavedSnapshot> {
    if (!this.lookup.savedValue) {
      return { present: false };
    }
    const value = await this.lookup.savedValue({
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

  private async resolveTarget(record: JobRecord, suggestion: OcrSuggestion, decision: OcrDecision): Promise<string> {
    const requested = decision.targetEntityId;
    const bound = suggestion.targetEntityId;
    if (bound && requested !== undefined && requested !== bound) {
      if (!isUuid(requested)) {
        throw ocrBadRequest(OCR_ERROR.targetInvalid, 'targetEntityId must be a UUID.');
      }
if (!(await this.targetBelongs(record, suggestion, requested))) {
        throw ocrNotFound();
      }
      throw ocrUnprocessable(OCR_ERROR.boundTargetImmutable, 'A bound target cannot be changed.');
    }
    const entityId = requested ?? bound;
    if (!entityId) {
      throw ocrUnprocessable(
        OCR_ERROR.targetRequired,
        'A suggestion needs targetEntityId before it can be accepted.',
      );
    }
    if (!isUuid(entityId)) {
      throw ocrBadRequest(OCR_ERROR.targetInvalid, 'targetEntityId must be a UUID.');
    }
if (!(await this.targetBelongs(record, suggestion, entityId))) {
      throw ocrNotFound();
    }
    if (suggestion.targetEntityType === 'payment') {
      await this.assertPaymentRecorded(record.job.propertyId, entityId);
    }
    return entityId;
  }

  private async assertPaymentRecorded(propertyId: string, entityId: string): Promise<void> {
    if (!this.lookup.paymentStatus) {
      throw ocrUnprocessable(
        OCR_ERROR.targetStatusUnknown,
        'A payment target must be checked before confirm.',
      );
    }
    const status = await this.lookup.paymentStatus({ propertyId, entityId });
    if (status === 'recorded') {
      return;
    }
    if (status === 'voided') {
      throw ocrUnprocessable(OCR_ERROR.targetVoided, 'A voided payment cannot be a confirm target.');
    }
    throw ocrUnprocessable(OCR_ERROR.targetStatusUnknown, 'A payment target must be checked before confirm.');
  }

  private async propertyTimeZone(propertyId: string): Promise<string> {
    const raw = await this.lookup.timeZone?.(propertyId);
    return readStoredTimezone(raw);
  }

  private async appendAudits(record: JobRecord, plan: PlanStep[]): Promise<void> {
    if (!this.lookup.appendAudit) {
      return;
    }
    for (const step of plan) {
      if (!step.audit) {
        continue;
      }
      const actorUserId = 'actorUserId' in step.audit ? step.audit.actorUserId : null;
      const sealed = sealAuditText(step.suggestion.fieldPath, step.audit);
      await this.lookup.appendAudit({
        propertyId: record.job.propertyId,
        actorUserId,
        action: confirmAuditAction(step.audit),
        entityType: step.suggestion.targetEntityType,
        entityId: step.entityId ?? null,
        metadata: sealed.metadata,
        beforeState: sealed.beforeState,
        afterState: sealed.afterState,
      });
    }
  }

  private async targetBelongs(record: JobRecord, suggestion: OcrSuggestion, entityId: string): Promise<boolean> {
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
    const bands = resolveConfidenceBands(this.runtime);
    const confidence = readConfidence(field.confidence);
    const lowConfidence = isLowConfidence(field.fieldPath, field.suggestedValue, confidence, bands.media);
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
      band: confidenceBand(confidence, lowConfidence, bands),
      lowConfidence,
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
throw ocrNotFound();
    }
    if (record.expiresAt <= this.clock.now()) {
      throw ocrGone('OCR job has expired.');
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
      confidenceBands: resolveConfidenceBands(this.runtime),
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

  private exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
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

function sameSaved(left: SavedSnapshot, right: SavedSnapshot): boolean {
  if (!left.present && !right.present) {
    return true;
  }
  if (left.present && right.present) {
    return JSON.stringify(left.value) === JSON.stringify(right.value);
  }
  return false;
}

/** Obligation fields and a document title can be saved. Payment fields and a property title cannot, yet. */
function persistableTarget(entityType: OcrSuggestion['targetEntityType']): boolean {
  return entityType === 'obligation' || entityType === 'document_meta';
}

function confirmAuditAction(audit: OcrConfirmAudit): string {
  if ('edited' in audit && audit.source === 'ocr') {
    return audit.edited ? 'ocr.edited' : 'ocr.accepted';
  }
  // EC-9.2: a saved replace is ocr.replaced. An unsaved Reemplazar writes no row.
  return 'ocr.replaced';
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
    throw ocrBadRequest(OCR_ERROR.invalidPath, 'Invalid path parameter.');
  }
}

function readConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function isLowConfidence(
  fieldPath: string,
  value: unknown,
  confidence: number | null,
  mediaThreshold: number,
): boolean {
  if (
    confidence === null ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    confidence < mediaThreshold
  ) {
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
