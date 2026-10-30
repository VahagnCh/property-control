import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { authEmailSenderFromEnv, authUsesMemoryStore } from './auth/auth-email.js';
import { FakeAuthEmailSender } from './auth/auth-email.js';
import { UnconfiguredAuthEmailSender } from './auth/resend-auth-email.js';
import { prepareBoot } from './boot.js';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const validSecret = Buffer.alloc(32, 9).toString('base64');
const shortSecret = Buffer.alloc(31, 9).toString('base64');

function publishedEnv(secret: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    AVISO_VERSION: '2026-10-21',
    AVISO_URL: 'https://example.com/aviso',
    APP_ENV: 'development',
    AUTH_EMAIL_FROM: 'DueRecord <hello@example.com>',
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

  it('rejects the Resend onboarding sender when APP_ENV is production', async () => {
    const env = publishedEnv(validSecret);
    env.APP_ENV = 'production';
    env.NODE_ENV = 'production';
    delete env.AUTH_EMAIL_FROM;
    await expect(prepareBoot(env, async () => true)).rejects.toThrow(/AUTH_EMAIL_FROM/);
    env.AUTH_EMAIL_FROM = 'DueRecord <onboarding@resend.dev>';
    await expect(prepareBoot(env, async () => true)).rejects.toThrow(/AUTH_EMAIL_FROM/);
    env.AUTH_EMAIL_FROM = 'DueRecord <other@resend.dev>';
    await expect(prepareBoot(env, async () => true)).rejects.toThrow(/AUTH_EMAIL_FROM/);
    env.AUTH_EMAIL_FROM = 'DueRecord <hello@example.com>';
    env.DATABASE_URL = 'postgresql://localhost/property_control';
    await expect(prepareBoot(env, async () => true)).resolves.toBeUndefined();
  });

  it('requires a database when APP_ENV is production or unset', async () => {
    const env = publishedEnv(validSecret);
    env.APP_ENV = 'production';
    delete env.DATABASE_URL;
    await expect(prepareBoot(env, async () => true)).rejects.toThrow(/DATABASE_URL/);
    delete env.APP_ENV;
    await expect(prepareBoot(env, async () => true)).rejects.toThrow(/DATABASE_URL/);
    env.APP_ENV = 'preview';
    await expect(prepareBoot(env, async () => true)).rejects.toThrow(/DATABASE_URL/);
    env.APP_ENV = 'staging';
    await expect(prepareBoot(env, async () => true)).resolves.toBeUndefined();
    env.APP_ENV = 'production';
    env.DATABASE_URL = 'postgresql://localhost/property_control';
    await expect(prepareBoot(env, async () => true)).resolves.toBeUndefined();
  });

  it('keeps production on Postgres when NODE_ENV is test and refuses the fake sender', () => {
    expect(() => authUsesMemoryStore({ NODE_ENV: 'test', APP_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(
      authUsesMemoryStore({
        NODE_ENV: 'test',
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost/property_control',
      }),
    ).toBe(false);
    expect(
      authUsesMemoryStore({
        NODE_ENV: 'production',
        APP_ENV: 'test',
        DATABASE_URL: 'postgresql://localhost/property_control',
      }),
    ).toBe(true);
    const production = authEmailSenderFromEnv({ APP_ENV: 'production', NODE_ENV: 'test' });
    expect(production).toBeInstanceOf(UnconfiguredAuthEmailSender);
    expect(production.configured).toBe(false);
    const unset = authEmailSenderFromEnv({ NODE_ENV: 'development' });
    expect(unset).toBeInstanceOf(UnconfiguredAuthEmailSender);
    const local = authEmailSenderFromEnv({ APP_ENV: 'development', NODE_ENV: 'production' });
    expect(local).toBeInstanceOf(FakeAuthEmailSender);
  });

  it('names APP_ENV in the example env and in CI', () => {
    const example = readFileSync(resolve(apiRoot, '.env.example'), 'utf8');
    expect(example).toContain('APP_ENV=');
    expect(example).toContain('APP_ENV=production fails closed');
    const ci = readFileSync(resolve(apiRoot, '../../.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('APP_ENV: test');
  });

  it('rejects the onboarding sender in staging when no allow-list is set', async () => {
    const env = publishedEnv(validSecret);
    env.APP_ENV = 'staging';
    env.NODE_ENV = 'production';
    env.AUTH_EMAIL_FROM = 'DueRecord <onboarding@resend.dev>';
    await expect(prepareBoot(env, async () => true)).rejects.toThrow(/AUTH_EMAIL_ALLOWED_RECIPIENTS/);
    delete env.AUTH_EMAIL_FROM;
    await expect(prepareBoot(env, async () => true)).rejects.toThrow(/AUTH_EMAIL_ALLOWED_RECIPIENTS/);
    env.AUTH_EMAIL_ALLOWED_RECIPIENTS = 'person@example.com';
    await expect(prepareBoot(env, async () => true)).resolves.toBeUndefined();
  });

  it('treats a missing or unknown APP_ENV as production for the onboarding sender', async () => {
    const env = publishedEnv(validSecret);
    env.NODE_ENV = 'production';
    env.AUTH_EMAIL_FROM = 'DueRecord <onboarding@resend.dev>';
    env.AUTH_EMAIL_ALLOWED_RECIPIENTS = 'person@example.com';
    delete env.APP_ENV;
    await expect(prepareBoot(env, async () => true)).rejects.toThrow(/AUTH_EMAIL_FROM/);
    env.APP_ENV = '   ';
    await expect(prepareBoot(env, async () => true)).rejects.toThrow(/AUTH_EMAIL_FROM/);
    env.APP_ENV = 'preview';
    await expect(prepareBoot(env, async () => true)).rejects.toThrow(/AUTH_EMAIL_FROM/);
    env.APP_ENV = 'staging';
    await expect(prepareBoot(env, async () => true)).resolves.toBeUndefined();
  });
});
