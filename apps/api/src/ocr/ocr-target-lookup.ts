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
   * Fail closed. True only when entityId exists in propertyId and is the
   * named entity type. A forged id, a foreign property, or the wrong type
   * is false.
   */
  belongsToProperty(input: {
    propertyId: string;
    entityType: OcrTargetEntityType;
    entityId: string;
  }): boolean;
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
