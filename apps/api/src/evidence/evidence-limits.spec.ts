import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_BYTES, checkEvidenceSize } from './evidence-limits.js';

describe('evidence size cap', () => {
  it('accepts 10,485,760 bytes and rejects one byte more', () => {
    expect(MAX_EVIDENCE_BYTES).toBe(10_485_760);
    expect(checkEvidenceSize(10_485_760)).toEqual({ ok: true });
    expect(checkEvidenceSize(10_485_761)).toEqual({
      ok: false,
      status: 413,
      error: 'evidence.too_large',
    });
  });

  it('uses that same number in both database checks', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../prisma');
    const sql = readFileSync(resolve(root, 'sql/checks.sql'), 'utf8');
    expect(sql).toContain(`size_bytes > 0 AND size_bytes <= ${MAX_EVIDENCE_BYTES}`);
    expect(sql).toContain(`byte_size > 0 AND byte_size <= ${MAX_EVIDENCE_BYTES}`);
    expect(sql).not.toContain('15728640');
  });
});
