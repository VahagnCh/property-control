import type { OcrTargetEntityType } from './ocr.types.js';

export interface ExtractedField {
  targetEntityType: OcrTargetEntityType;
  fieldPath: string;
  suggestedValue: unknown;
  confidence?: number | null;
  targetEntityId?: string;
}

export interface OcrExtractResult {
  outcome: 'suggested' | 'failed' | 'pending' | 'processing';
  error?: string;
  suggestions?: ExtractedField[];
}

export interface OcrExtractor {
  extract(input: { propertyId: string; documentId: string }): OcrExtractResult;
}

export const OCR_EXTRACTOR = Symbol('OCR_EXTRACTOR');

function daysFromNow(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

export class StubOcrExtractor implements OcrExtractor {
  extract(input: { propertyId: string; documentId: string }): OcrExtractResult {
    return {
      outcome: 'suggested',
      suggestions: [
        {
          targetEntityType: 'obligation',
          fieldPath: 'expectedAmount',
          suggestedValue: '18450.00',
          confidence: 0.81,
        },
        {
          targetEntityType: 'obligation',
          fieldPath: 'nextDueDate',
          suggestedValue: daysFromNow(30),
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
          targetEntityId: input.documentId,
          fieldPath: 'title',
          suggestedValue: 'Hipoteca',
          confidence: 0.7,
        },
      ],
    };
  }
}
