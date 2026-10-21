import { Injectable } from '@nestjs/common';
import { isTraversal, isUuid } from '../common/path-safety.js';
import { OCR_ERROR, ocrBadRequest } from './ocr-errors.js';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface ObjectStorage {
  buildOcrSourceKey(propertyId: string, documentId: string): string;
}

/**
 * Builds a private storage key from ids that have already been checked.
 * The key is never copied onto an OCR response.
 */
@Injectable()
export class PrivateObjectStorage implements ObjectStorage {
  readonly calls: string[] = [];

  buildOcrSourceKey(propertyId: string, documentId: string): string {
    if (
      !isUuid(propertyId) ||
      !isUuid(documentId) ||
      isTraversal(propertyId) ||
      isTraversal(documentId)
    ) {
throw ocrBadRequest(OCR_ERROR.invalidSourceKey, 'Invalid source key input.');
    }
    const key = `properties/${propertyId}/documents/${documentId}/ocr-stub`;
    this.calls.push(key);
    return key;
  }
}
