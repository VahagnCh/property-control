import { describe, expect, it } from 'vitest';
import { loadObjectStorageConfig } from './object-storage-config.js';

describe('object storage config', () => {
  it('stays unset when no storage variables are present', () => {
    expect(loadObjectStorageConfig({})).toBeUndefined();
  });

  it('reads an S3-compatible endpoint without a provider SDK', () => {
    expect(
      loadObjectStorageConfig({
        OBJECT_STORAGE_ENDPOINT: ' https://example.r2.cloudflarestorage.com ',
        OBJECT_STORAGE_REGION: 'auto',
        OBJECT_STORAGE_BUCKET: 'evidence',
        OBJECT_STORAGE_ACCESS_KEY_ID: 'key',
        OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret',
        OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
      }),
    ).toEqual({
      endpoint: 'https://example.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'evidence',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      forcePathStyle: true,
    });
  });

  it('rejects a non-http endpoint', () => {
    expect(() =>
      loadObjectStorageConfig({
        OBJECT_STORAGE_ENDPOINT: 'ftp://files.example',
        OBJECT_STORAGE_REGION: 'auto',
        OBJECT_STORAGE_BUCKET: 'evidence',
        OBJECT_STORAGE_ACCESS_KEY_ID: 'key',
        OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret',
      }),
    ).toThrow(/http\(s\)/);
  });
});
