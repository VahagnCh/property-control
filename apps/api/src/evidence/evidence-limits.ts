/** Trust cap: 10 MiB, exactly 10 * 1024 * 1024. Shared by evidence and documents. */
export const MAX_EVIDENCE_BYTES = 10_485_760;

export function checkEvidenceSize(
  bytes: number,
): { ok: true } | { ok: false; status: 413 | 422; error: 'evidence.too_large' | 'evidence.invalid_size' } {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, status: 422, error: 'evidence.invalid_size' };
  }
  if (bytes > MAX_EVIDENCE_BYTES) {
    return { ok: false, status: 413, error: 'evidence.too_large' };
  }
  return { ok: true };
}
