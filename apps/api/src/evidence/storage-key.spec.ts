import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_SOURCE_KEY,
  DOCUMENT_SOURCE_KEY_SQL,
  EVIDENCE_SOURCE_KEY,
  EVIDENCE_SOURCE_KEY_SQL,
  documentSourceKey,
  evidenceSourceKey,
  isAcceptedSourceKey,
  storageEnvFromConfig,
} from './storage-key.js';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('storage object keys', () => {
  it('matches the new evidence and document shapes', () => {
    expect(evidenceSourceKey('staging')).toMatch(EVIDENCE_SOURCE_KEY);
    expect(documentSourceKey('prod')).toMatch(DOCUMENT_SOURCE_KEY);
  });

  it('contains no property id or user id', () => {
    for (const key of [evidenceSourceKey('staging'), documentSourceKey('prod')]) {
      expect(key).not.toContain(PROPERTY_ID);
      expect(key).not.toContain(USER_ID);
      expect(key).not.toContain('properties/');
    }
  });

  it('never issues the same key twice', () => {
    expect(evidenceSourceKey('staging')).not.toBe(evidenceSourceKey('staging'));
    expect(documentSourceKey('prod')).not.toBe(documentSourceKey('prod'));
  });

  it('rejects an old properties/ key', () => {
    const oldEvidence = `properties/${PROPERTY_ID}/evidence/${USER_ID}/${PROPERTY_ID}`;
    const oldDocument = `properties/${PROPERTY_ID}/documents/${USER_ID}/ocr-stub`;
    expect(isAcceptedSourceKey(oldEvidence)).toBe(false);
    expect(isAcceptedSourceKey(oldDocument)).toBe(false);
    expect(EVIDENCE_SOURCE_KEY.test(oldEvidence)).toBe(false);
    expect(DOCUMENT_SOURCE_KEY.test(oldDocument)).toBe(false);
  });

  it('reads the env from config', () => {
    expect(storageEnvFromConfig({ OBJECT_STORAGE_ENV: 'staging' })).toBe('staging');
    expect(storageEnvFromConfig({ OBJECT_STORAGE_ENV: 'prod' })).toBe('prod');
    expect(evidenceSourceKey(storageEnvFromConfig({ OBJECT_STORAGE_ENV: 'prod' }))).toMatch(/^prod\/evidence\//);
    expect(documentSourceKey(storageEnvFromConfig({ OBJECT_STORAGE_ENV: 'staging' }))).toMatch(
      /^staging\/documents\//,
    );
    expect(() => storageEnvFromConfig({})).toThrow(/OBJECT_STORAGE_ENV must be staging or prod/);
    expect(() => storageEnvFromConfig({ OBJECT_STORAGE_ENV: 'production' })).toThrow(
      /OBJECT_STORAGE_ENV must be staging or prod/,
    );
  });

  it('uses that same pattern in the new migration and the checks file', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../prisma');
    const migration = readFileSync(
      resolve(root, 'migrations/20261021210000_source_key_shape/migration.sql'),
      'utf8',
    );
    const checks = readFileSync(resolve(root, 'sql/checks.sql'), 'utf8');
    for (const sql of [migration, checks]) {
      expect(sql).toContain('evidence_source_key_shape');
      expect(sql).toContain('documents_source_key_shape');
      expect(sql).toContain('ocr_jobs_source_key_shape');
      expect(sql).toContain(EVIDENCE_SOURCE_KEY_SQL);
      expect(sql).toContain(DOCUMENT_SOURCE_KEY_SQL);
    }
  });
});
