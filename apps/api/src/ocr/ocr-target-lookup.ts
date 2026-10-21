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
  }): boolean;
  /**
   * Payment targets only. 'voided' rejects confirm with 422.
   * Omitted means the payment is recorded.
   */
  paymentStatus?(input: { propertyId: string; entityId: string }): 'recorded' | 'voided';
  /** IANA name. Omitted means America/Mexico_City. */
  timeZone?(propertyId: string): string | undefined;
  /**
   * Persisted field value. undefined or null means nothing is saved.
   * Unsaved form text is not provided here.
   */
  savedValue?(input: SavedFieldQuery): unknown;
  saveValue?(input: SavedFieldQuery, value: unknown): void;
}

export class FailClosedOcrTargetLookup implements OcrTargetLookup {
  belongsToProperty(): boolean {
    return false;
  }
}
