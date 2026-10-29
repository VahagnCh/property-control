import { describe, expect, it } from 'vitest';
import { DOCUMENT_SOURCE_KEY } from '../evidence/storage-key.js';
import { PrivateObjectStorage } from './object-storage.js';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('private object storage', () => {
  it('builds a document key from the configured env', () => {
    const staging = new PrivateObjectStorage({ OBJECT_STORAGE_ENV: 'staging' });
    const prod = new PrivateObjectStorage({ OBJECT_STORAGE_ENV: 'prod' });
    const stagingKey = staging.buildOcrSourceKey();
    const prodKey = prod.buildOcrSourceKey();
    expect(stagingKey).toMatch(DOCUMENT_SOURCE_KEY);
    expect(stagingKey.startsWith('staging/documents/')).toBe(true);
    expect(prodKey.startsWith('prod/documents/')).toBe(true);
    expect(stagingKey).not.toContain(PROPERTY_ID);
    expect(stagingKey).not.toContain(USER_ID);
    expect(stagingKey).not.toBe(staging.buildOcrSourceKey());
  });
});
