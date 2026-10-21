import type { OcrTargetEntityType } from './ocr.types.js';

export const OCR_TARGET_LOOKUP = Symbol('OCR_TARGET_LOOKUP');

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
}

export class FailClosedOcrTargetLookup implements OcrTargetLookup {
  belongsToProperty(): boolean {
    return false;
  }
}
