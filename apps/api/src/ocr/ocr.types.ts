export const OCR_JOB_STATUSES = [
  'pending',
  'processing',
  'suggested',
  'confirmed',
  'rejected',
  'failed',
] as const;

export type OcrJobStatus = (typeof OCR_JOB_STATUSES)[number];

export const OCR_APPLY_STATUSES = ['pending', 'accepted', 'rejected'] as const;

export type OcrApplyStatus = (typeof OCR_APPLY_STATUSES)[number];

export const OCR_TARGET_ENTITY_TYPES = [
  'obligation',
  'payment',
  'property',
  'document_meta',
] as const;

export type OcrTargetEntityType = (typeof OCR_TARGET_ENTITY_TYPES)[number];

/**
 * Public job shape. storageKey is intentionally absent: a private key may be
 * built server-side, and it is never copied onto a response.
 */
export interface OcrJob {
  id: string;
  propertyId: string;
  documentId: string;
  evidenceId?: string;
  status: OcrJobStatus;
  vendor?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OcrSuggestion {
  id: string;
  ocrJobId: string;
  targetEntityType: OcrTargetEntityType;
  targetEntityId?: string;
  fieldPath: string;
  suggestedValue: unknown;
  confidence?: number | null;
  lowConfidence: boolean;
  userEditedValue?: unknown | null;
  applyStatus: OcrApplyStatus;
}

export interface OcrDecision {
  suggestionId: string;
  action: 'accept' | 'reject' | 'edit';
  editedValue?: unknown;
  targetEntityId?: string;
}

export interface OcrAppliedField {
  suggestionId: string;
  entityType: OcrTargetEntityType;
  entityId: string;
  fieldPath: string;
}

export interface OcrConfirmResult {
  job: OcrJob;
  suggestions: OcrSuggestion[];
  applied: OcrAppliedField[];
  /**
   * Scaffold marker. confirm() records the decision in memory and does not
   * write Obligation, Payment, Property, or Document rows.
   */
  persisted: false;
}
