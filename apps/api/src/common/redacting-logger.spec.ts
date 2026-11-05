import { describe, expect, it, vi } from 'vitest';
import { RedactingLogger } from './redacting-logger.js';

describe('RedactingLogger', () => {
  it('redacts Nest error lines, including an Error stack', () => {
    const logger = new RedactingLogger();
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      const error = new Error('mail person@example.com code 123456');
      logger.error(error);
      const dumped = chunks.join('');
      expect(dumped).toContain('[redacted-email]');
      expect(dumped).toContain('[redacted-code]');
      expect(dumped).not.toContain('person@example.com');
      expect(dumped).not.toContain('123456');
    } finally {
      spy.mockRestore();
    }
  });
});
