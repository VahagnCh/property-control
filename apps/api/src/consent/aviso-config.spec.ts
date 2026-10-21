import { describe, expect, it } from 'vitest';
import { loadAvisoConfig } from './aviso-config.js';

describe('loadAvisoConfig', () => {
  it('rejects a missing version or a non-http URL', () => {
    expect(() => loadAvisoConfig({})).toThrow(/AVISO_VERSION/);
    expect(() => loadAvisoConfig({ AVISO_VERSION: '   ', AVISO_URL: 'https://example.com/a' })).toThrow(
      /AVISO_VERSION/,
    );
    expect(() => loadAvisoConfig({ AVISO_VERSION: '2026-10-21' })).toThrow(/AVISO_URL/);
    expect(() => loadAvisoConfig({ AVISO_VERSION: '2026-10-21', AVISO_URL: 'not a url' })).toThrow(/AVISO_URL/);
    expect(() => loadAvisoConfig({ AVISO_VERSION: '2026-10-21', AVISO_URL: 'ftp://example.com/a' })).toThrow(
      /AVISO_URL/,
    );
  });

  it('accepts http and https and trims both values', () => {
    expect(loadAvisoConfig({ AVISO_VERSION: ' 2026-10-21 ', AVISO_URL: ' https://example.com/aviso ' })).toEqual({
      avisoVersion: '2026-10-21',
      avisoUrl: 'https://example.com/aviso',
    });
    expect(loadAvisoConfig({ AVISO_VERSION: 'v1', AVISO_URL: 'http://localhost/aviso' }).avisoUrl).toBe(
      'http://localhost/aviso',
    );
  });
});
