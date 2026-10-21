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
  /** Alta ≥ 0.90, media ≥ 0.80. The same numbers the mobile bands use. */
  confidenceBands: { alta: 0.9; media: 0.8 };
  /** Stable extract failure code. Raw extractor text is never copied here. */
  errorCode?: string;
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
  /** alta ≥ 0.90, media ≥ 0.80, revisa below 0.80 or missing. */
  band: 'alta' | 'media' | 'revisa';
  lowConfidence: boolean;
  userEditedValue?: unknown | null;
  applyStatus: OcrApplyStatus;
}

export interface OcrDecision {
  suggestionId: string;
  action: 'accept' | 'reject' | 'edit' | 'replace';
  editedValue?: unknown;
  targetEntityId?: string;
}

export interface OcrAppliedField {
  suggestionId: string;
  entityType: OcrTargetEntityType;
  entityId: string;
  fieldPath: string;
}

/** Saved field. The previous value is the persisted server value. */
export interface SavedReplaceAudit {
  suggestionId: string;
  field: string;
  action: 'replace';
  actorUserId: string | null;
  previousValue: unknown;
  newValue: unknown;
}

/**
 * Nothing is saved yet. No client-typed prior value is stored.
 * decision is 'replaced'. suggestedValue is the validated suggestion.
 */
export interface UnsavedReplaceAudit {
  suggestionId: string;
  field: string;
  decision: 'replaced';
  suggestedValue: unknown;
}

export type OcrReplaceAudit = SavedReplaceAudit | UnsavedReplaceAudit;

/** Shape the payment create audit uses when the field came from replace. */
export interface OcrReplaceCreateAudit {
  source: 'ocr_replace';
  suggestionId: string;
  field: string;
}

export function paymentCreateAuditFromReplace(audit: {
  suggestionId: string;
  field: string;
}): OcrReplaceCreateAudit {
  return { source: 'ocr_replace', suggestionId: audit.suggestionId, field: audit.field };
}

export interface OcrConfirmResult {
  job: OcrJob;
  suggestions: OcrSuggestion[];
  applied: OcrAppliedField[];
  audits: OcrReplaceAudit[];
  /**
   * Scaffold marker. confirm() records the decision in memory and does not
   * write Obligation, Payment, Property, or Document rows.
   */
  persisted: false;
}
