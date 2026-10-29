import { describe, expect, it } from 'vitest';
import { redactedTextState, sealAuditText } from './audit-text.js';
import type { OcrAppliedFieldAudit, SavedReplaceAudit } from './ocr.types.js';

const NOTE = 'Linea 1\r\nNota secreta 88421';
const STORED = 'Linea 1\nNota secreta 88421';

describe('redacted audit text', () => {
  it('hashes the NFC and LF normalized text and counts UTF-16 units', () => {
    const composed = 'Mun\u0303oz';
    const state = redactedTextState(`${composed}\r\n${NOTE}`);
    const stored = `Muñoz\n${STORED}`;
    expect(state).toEqual(redactedTextState(stored));
    expect(state.length).toBe(stored.length);
    expect(state.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(redactedTextState('😀').length).toBe(2);
  });

  it('keeps notes and description out of metadata and puts length and hash on the states', () => {
    const edit: OcrAppliedFieldAudit = {
      source: 'ocr',
      ocrJobId: 'job-1',
      suggestionId: 'sug-1',
      field: 'notes',
      actorUserId: 'user-1',
      confidence: 0.7,
      edited: true,
      previousValue: null,
      newValue: NOTE,
    };
    const sealed = sealAuditText('notes', edit);
    expect(sealed.beforeState).toBeNull();
    expect(sealed.afterState).toEqual(redactedTextState(STORED));
    expect(sealed.metadata).toMatchObject({
      confidence: 0.7,
      ocrJobId: 'job-1',
      field: 'notes',
      edited: true,
    });
    expect(sealed.metadata).not.toHaveProperty('newValue');
    expect(JSON.stringify(sealed)).not.toContain('Nota secreta');
    expect(JSON.stringify(sealed)).not.toContain(NOTE);

    const description: SavedReplaceAudit = {
      suggestionId: 'sug-2',
      field: 'description',
      action: 'replace',
      actorUserId: 'user-1',
      previousValue: 'antes',
      newValue: 'despues',
    };
    const replaced = sealAuditText('description', description);
    expect(replaced.beforeState).toEqual(redactedTextState('antes'));
    expect(replaced.afterState).toEqual(redactedTextState('despues'));
    expect(JSON.stringify(replaced)).not.toContain('antes');
    expect(JSON.stringify(replaced)).not.toContain('despues');
    expect(replaced.metadata).not.toHaveProperty('previousValue');
    expect(replaced.metadata).not.toHaveProperty('newValue');
  });

  it('leaves a single-line field value on the audit', () => {
    const edit: OcrAppliedFieldAudit = {
      source: 'ocr',
      ocrJobId: 'job-1',
      suggestionId: 'sug-1',
      field: 'providerName',
      actorUserId: null,
      confidence: 0.9,
      edited: false,
      previousValue: null,
      newValue: 'CFE',
    };
    const sealed = sealAuditText('providerName', edit);
    expect(sealed.beforeState).toBeNull();
    expect(sealed.afterState).toBeNull();
    expect(sealed.metadata).toMatchObject({ newValue: 'CFE', confidence: 0.9, ocrJobId: 'job-1' });
  });
});
