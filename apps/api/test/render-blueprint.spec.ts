import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const SECRET_KEYS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'SERVER_SECRET',
  'APP_ROLE_PASSWORD',
  'AVISO_VERSION',
  'AVISO_URL',
  'CORS_ORIGINS',
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_REGION',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ACCESS_KEY_ID',
  'OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'RESEND_API_KEY',
];

describe('render blueprint', () => {
  const blueprint = readFileSync(resolve(root, 'render.yaml'), 'utf8');
  const bootstrap = readFileSync(resolve(root, 'apps/api/prisma/bootstrap-app-role.sh'), 'utf8');
  const seed = readFileSync(resolve(root, 'apps/api/src/persistence/seed-data.ts'), 'utf8');
  const deploy = readFileSync(resolve(root, 'docs/DEPLOY.md'), 'utf8');

  it('keeps every secret as sync false with no value', () => {
    expect(blueprint).toContain('plan: free');
    expect(blueprint).toContain('healthCheckPath: /v1/health');
    expect(blueprint).toContain('prisma migrate deploy');
    for (const key of SECRET_KEYS) {
      const block = blueprint.match(new RegExp(`- key: ${key}\\n        sync: false\\n`));
      expect(block, key).not.toBeNull();
    }
    expect(blueprint).not.toMatch(/postgres(ql)?:\/\//);
    expect(blueprint).not.toMatch(/sync: false\n        value:/);
    expect(blueprint).not.toMatch(/\bvalue:\s+\S*(secret|password|key|token)/i);
    expect(blueprint).not.toMatch(/AKIA[0-9A-Z]{8,}/);
    expect(blueprint).not.toMatch(/re_[A-Za-z0-9]/);
  });

  it('passes the app-role password through psql getenv and turns DDL logging off', () => {
    expect(bootstrap).toContain('\\getenv app_password APP_ROLE_PASSWORD');
    expect(bootstrap).toContain("SET log_statement = 'none'");
    expect(bootstrap).toContain('SET log_min_duration_statement = -1');
    expect(bootstrap).not.toMatch(/-v\s+app_password/);
    expect(bootstrap).not.toMatch(/--set(?:=|\s+)app_password/);
    expect(bootstrap).not.toContain("PASSWORD 'property_control_app'");
    expect(deploy).toContain('openssl rand -base64 32');
    expect(deploy).toContain('\\getenv');
  });

  it('seeds only the demo rows', () => {
    expect(seed).toContain("trustSub: 'demo'");
    expect(seed).toContain("displayName: 'Demo'");
    expect(seed).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(seed).not.toMatch(/password|token|Bearer/i);
  });
});
