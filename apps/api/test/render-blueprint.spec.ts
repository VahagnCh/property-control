import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const WEB_SECRETS = [
  'DATABASE_URL',
  'SERVER_SECRET',
  'AVISO_VERSION',
  'AVISO_URL',
  'CORS_ORIGINS',
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_REGION',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ACCESS_KEY_ID',
  'OBJECT_STORAGE_SECRET_ACCESS_KEY',
];

const ABSENT_FROM_WEB = ['DIRECT_URL', 'APP_ROLE_PASSWORD', 'RESEND_API_KEY'];

describe('render blueprint', () => {
  const blueprint = readFileSync(resolve(root, 'render.yaml'), 'utf8');
  const bootstrap = readFileSync(resolve(root, 'apps/api/prisma/bootstrap-app-role.sh'), 'utf8');
  const seed = readFileSync(resolve(root, 'apps/api/src/persistence/seed-data.ts'), 'utf8');
  const deploy = readFileSync(resolve(root, 'docs/DEPLOY.md'), 'utf8');

  it('keeps every web secret as sync false with no value', () => {
    expect(blueprint).toContain('plan: free');
    expect(blueprint).toContain('healthCheckPath: /v1/health');
    expect(blueprint).not.toContain('preDeployCommand');
    expect(blueprint).not.toContain('prisma migrate deploy');
    for (const key of WEB_SECRETS) {
      const block = blueprint.match(new RegExp(`- key: ${key}\\n        sync: false\\n`));
      expect(block, key).not.toBeNull();
    }
    for (const key of ABSENT_FROM_WEB) {
      expect(blueprint, key).not.toContain(key);
    }
    expect(blueprint).not.toMatch(/postgres(ql)?:\/\//);
    expect(blueprint).not.toMatch(/sync: false\n        value:/);
    expect(blueprint).not.toMatch(/\bvalue:\s+\S*(secret|password|key|token)/i);
    expect(blueprint).not.toMatch(/AKIA[0-9A-Z]{8,}/);
    expect(blueprint).not.toMatch(/re_[A-Za-z0-9]/);
    expect(blueprint).toContain('HSTS_INCLUDE_SUBDOMAINS');
    expect(blueprint).toContain('value: "false"');
  });

  it('hashes the app-role password and keeps it off the psql command line', () => {
    expect(bootstrap).toContain('\\getenv scram_password SCRAM_PASSWORD');
    expect(bootstrap).toContain('scramSha256Password');
    expect(bootstrap).toContain('psql 16');
    expect(bootstrap).not.toContain("SET log_statement");
    expect(bootstrap).not.toContain('log_min_duration_statement');
    expect(bootstrap).not.toMatch(/-v\s+app_password/);
    expect(bootstrap).not.toMatch(/--set(?:=|\s+)app_password/);
    expect(bootstrap).not.toContain("PASSWORD 'property_control_app'");
    expect(deploy).toContain('openssl rand -base64 32');
    expect(deploy).toContain('\\getenv');
    expect(deploy).toContain('16 or newer');
    expect(deploy).toContain('PGPASSWORD');
    expect(deploy).toContain('SCRAM-SHA-256');
  });

  it('seeds only the demo rows, and only behind a flag', () => {
    expect(seed).toContain("trustSub: 'demo'");
    expect(seed).toContain("displayName: 'Demo'");
    expect(seed).toContain('SEED_DEMO_DATA');
    expect(seed).toContain('PUBLISH_AVISO');
    expect(seed).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(seed).not.toMatch(/password|token|Bearer/i);
  });
});
