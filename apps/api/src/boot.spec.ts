import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { prepareBoot } from './boot.js';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const validSecret = Buffer.alloc(32, 9).toString('base64');
const shortSecret = Buffer.alloc(31, 9).toString('base64');

function publishedEnv(secret: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    AVISO_VERSION: '2026-10-21',
    AVISO_URL: 'https://example.com/aviso',
  };
  if (secret !== undefined) {
    env.SERVER_SECRET = secret;
  }
  return env;
}

function productionSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...productionSources(path));
      continue;
    }
    if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) {
      files.push(path);
    }
  }
  return files;
}

describe('prepareBoot', () => {
  it('fails for an empty secret and does not look up the aviso', async () => {
    const finder = vi.fn(async () => true);
    await expect(prepareBoot(publishedEnv(''), finder)).rejects.toThrow('SERVER_SECRET is required.');
    await expect(prepareBoot(publishedEnv('   '), finder)).rejects.toThrow('SERVER_SECRET is required.');
    expect(finder).not.toHaveBeenCalled();
  });

  it('fails for a missing secret and does not look up the aviso', async () => {
    const finder = vi.fn(async () => true);
    await expect(prepareBoot(publishedEnv(undefined), finder)).rejects.toThrow('SERVER_SECRET is required.');
    expect(finder).not.toHaveBeenCalled();
  });

  it('fails for a secret that decodes to fewer than 32 bytes', async () => {
    const finder = vi.fn(async () => true);
    await expect(prepareBoot(publishedEnv(shortSecret), finder)).rejects.toThrow(
      'SERVER_SECRET must decode to at least 32 bytes.',
    );
    const invalid = 'this-is-not-canonical-base64-key-material!!';
    try {
      await prepareBoot(publishedEnv(invalid), finder);
      throw new Error('expected a short or invalid secret to fail boot');
    } catch (error) {
      expect((error as Error).message).toBe('SERVER_SECRET must decode to at least 32 bytes.');
      expect((error as Error).message).not.toContain(invalid);
      expect((error as Error).message).not.toContain(shortSecret);
    }
    expect(finder).not.toHaveBeenCalled();
  });

  it('fails when the configured aviso version has no row', async () => {
    const finder = vi.fn(async () => false);
    await expect(prepareBoot(publishedEnv(validSecret), finder)).rejects.toThrow(
      'AVISO_VERSION is not published.',
    );
    expect(finder).toHaveBeenCalledWith('2026-10-21');
  });

  it('continues when the secret decodes to 32 bytes and the aviso row exists', async () => {
    const finder = vi.fn(async () => true);
    await expect(prepareBoot(publishedEnv(validSecret), finder)).resolves.toBeUndefined();
    const urlSafe = Buffer.alloc(32, 3).toString('base64url');
    await expect(prepareBoot(publishedEnv(urlSafe), finder)).resolves.toBeUndefined();
  });

  it('is called from the process entrypoint', () => {
    const main = readFileSync(resolve(apiRoot, 'src/main.ts'), 'utf8');
    expect(main).toContain('prepareBoot(');
  });

  it('keeps the test secret identifier out of production sources', () => {
    const hits = productionSources(resolve(apiRoot, 'src')).filter((path) =>
      readFileSync(path, 'utf8').includes('TEST_SERVER_SECRET'),
    );
    expect(hits).toEqual([]);
  });
});
