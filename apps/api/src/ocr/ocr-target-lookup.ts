import type { OcrTargetEntityType } from './ocr.types.js';

export const OCR_TARGET_LOOKUP = Symbol('OCR_TARGET_LOOKUP');

export interface SavedFieldQuery {
  propertyId: string;
  entityType: OcrTargetEntityType;
  entityId: string;
  fieldPath: string;
}

export interface OcrTargetLookup {
  /**
   * Fail closed. True only when entityId exists in propertyId, is the named
   * entity type, and is not soft-deleted. A forged id, a foreign property,
   * the wrong type, or a soft-deleted row is false, and confirm answers 404.
   * A voided payment still belongs: it exists. paymentStatus reports the void.
   */
  belongsToProperty(input: {
    propertyId: string;
    entityType: OcrTargetEntityType;
    entityId: string;
  }): boolean | Promise<boolean>;
  /**
   * Payment targets only. `recorded` allows confirm. `voided` is 422
   * `target_voided`. Any other status, or a missing method, is 422
   * `target_status_unknown`.
   */
paymentStatus?(input: {
    propertyId: string;
    entityId: string;
  }): string | undefined | Promise<string | undefined>;
  /** IANA name. Omitted or blank means America/Mexico_City. An invalid stored name fails. */
  timeZone?(propertyId: string): string | undefined | Promise<string | undefined>;
  /**
   * Persisted field value. undefined or null means nothing is saved.
   * Unsaved form text is not provided here.
   */
  savedValue?(input: SavedFieldQuery): unknown | Promise<unknown>;
  saveValue?(input: SavedFieldQuery, value: unknown): void | Promise<void>;
  /**
   * When present, confirm runs its writes and audit appends inside this
   * callback. A throw rolls the callback's writes back.
   */
  runInTransaction?<T>(work: () => Promise<T>): Promise<T>;
  appendAudit?(event: OcrAuditAppend): void | Promise<void>;
}

export interface OcrAuditAppend {
  propertyId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  /** Null when that side has no text. Multi-line free text is `{ length, sha256 }` only. */
  beforeState?: { length: number; sha256: string } | null;
  afterState?: { length: number; sha256: string } | null;
}

export class FailClosedOcrTargetLookup implements OcrTargetLookup {
  belongsToProperty(): boolean {
    return false;
  }
}
