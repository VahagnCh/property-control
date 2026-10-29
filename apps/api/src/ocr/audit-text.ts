import { createHash } from 'node:crypto';
import { isMultilineAuditField } from './ocr-fields.js';
import type { OcrConfirmAudit } from './ocr.types.js';

/** Trust rev f.5 §9. Length is UTF-16 code units. sha256 is hex. */
export interface RedactedTextState {
  length: number;
  sha256: string;
}

/**
 * SHA-256 of the NFC-normalized, LF-normalized text. That string is what the
 * database stores for notes and maintenance description. Length uses
 * `string.length`, the same UTF-16 count as §8.3.
 */
export function redactedTextState(text: string): RedactedTextState {
  const normalized = text.normalize('NFC').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return {
    length: normalized.length,
    sha256: createHash('sha256').update(normalized, 'utf8').digest('hex'),
  };
}

export interface SealedAudit {
  metadata: Record<string, unknown>;
  beforeState: RedactedTextState | null;
  afterState: RedactedTextState | null;
  callerAudit: OcrConfirmAudit;
}

/**
 * Multi-line free text never stays on the audit. `before_state` and
 * `after_state` are length + hash, or null when that side has no text.
 * Metadata keeps the other fields, including confidence and ocrJobId.
 */
export function sealAuditText(field: string, audit: OcrConfirmAudit): SealedAudit {
  if (!isMultilineAuditField(field)) {
    return {
      metadata: { ...audit },
      beforeState: null,
      afterState: null,
      callerAudit: audit,
    };
  }
  const raw = audit as unknown as Record<string, unknown>;
  const beforeText = typeof raw.previousValue === 'string' ? raw.previousValue : null;
  const afterSource = typeof raw.newValue === 'string' ? raw.newValue : raw.suggestedValue;
  const afterText = typeof afterSource === 'string' ? afterSource : null;
  const metadata: Record<string, unknown> = { ...raw };
  delete metadata.newValue;
  delete metadata.previousValue;
  delete metadata.suggestedValue;
  return {
    metadata,
    beforeState: beforeText === null ? null : redactedTextState(beforeText),
    afterState: afterText === null ? null : redactedTextState(afterText),
    callerAudit: metadata as unknown as OcrConfirmAudit,
  };
}
