import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { logError, redactForLog } from './log-redaction.js';

describe('redactForLog', () => {
  it('removes emails, tokens, codes, and signed URLs', () => {
    const signed =
      'https://bucket.example/file?X-Amz-Signature=abcdef0123456789&X-Amz-Credential=AKIAEXAMPLE';
    const raw = [
      'user person@example.com jose@correo.mx user@münchen.de',
      'bearer Bearer eyJhbGciOi.payload.sig',
      'basic Basic dXNlcjpwYXNz',
      'Cookie: session=abc; refresh=xyz',
      'refreshToken=raw-refresh-value',
      'Idempotency-Key: idem-123',
      'code 123456',
      `url ${signed}`,
      'amount 123456 expected 85000 wire 19000.00',
    ].join('\n');
    const redacted = redactForLog(raw);
    expect(redacted).not.toContain('person@example.com');
    expect(redacted).not.toContain('jose@correo.mx');
    expect(redacted).not.toContain('münchen.de');
    expect(redacted).not.toContain('eyJhbGciOi');
    expect(redacted).not.toContain('dXNlcjpwYXNz');
    expect(redacted).not.toContain('session=abc');
    expect(redacted).not.toContain('raw-refresh-value');
    expect(redacted).not.toContain('idem-123');
    expect(redacted).not.toContain('code 123456');
    expect(redacted).not.toContain('X-Amz-Signature=');
    expect(redacted).not.toContain('AKIAEXAMPLE');
    expect(redacted).toContain('[redacted-email]');
    expect(redacted).toContain('[redacted-token]');
    expect(redacted).toContain('[redacted-code]');
    expect(redacted).toContain('[redacted-url]');
    expect(redacted).toContain('Basic [redacted]');
    expect(redacted).toContain('[redacted-cookie]');
    expect(redacted).toContain('amount 123456');
    expect(redacted).toContain('85000');
    expect(redacted).toContain('19000.00');
  });

  it('logs only the redacted line', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      logError('mail person@example.com code 654321');
      expect(spy).toHaveBeenCalledWith('mail [redacted-email] code [redacted-code]');
      expect(JSON.stringify(spy.mock.calls)).not.toContain('person@example.com');
      expect(JSON.stringify(spy.mock.calls)).not.toContain('654321');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the existing error logs free of request data', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const sources = [
      'consent/consent.service.ts',
      'health/live-health.controller.ts',
      'properties/property.response.ts',
    ].map((path) => readFileSync(resolve(root, path), 'utf8'));
    for (const source of sources) {
      expect(source).not.toMatch(/console\.(log|error|warn|info|debug)/);
      expect(source).not.toMatch(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    }
  });
});
