import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { notFoundBody } from '../common/not-found.js';
import { PropertyFileIds, isOpaqueFileId } from './file-ids.js';

const PROPERTY_A = '11111111-1111-4111-8111-111111111111';
const PROPERTY_B = '11111111-1111-4111-8111-222222222222';

describe('fileId', () => {
  it('issues a v4 UUID that is not the storage key or a path', () => {
    const files = new PropertyFileIds();
    const issued = files.issue(PROPERTY_A);
    const sourceKey = files.sourceKey(issued.fileId);
    expect(isOpaqueFileId(issued.fileId)).toBe(true);
    expect(issued).toEqual({ fileId: issued.fileId });
    expect(sourceKey).toBeDefined();
    expect(issued.fileId).not.toBe(sourceKey);
    expect(sourceKey).not.toContain(issued.fileId);
    expect(issued.fileId).not.toContain('properties/');
    expect(JSON.stringify(issued)).not.toMatch(/storageKey|storage_key|properties\//);
  });

  it('returns 404 for a foreign or unknown fileId', () => {
    const files = new PropertyFileIds();
    const issued = files.issue(PROPERTY_A);
    expect(files.resolve(PROPERTY_A, issued.fileId)).toEqual({ fileId: issued.fileId });
    expect(() => files.resolve(PROPERTY_B, issued.fileId)).toThrow(NotFoundException);
    try {
      files.resolve(PROPERTY_B, issued.fileId);
    } catch (error) {
      expect((error as NotFoundException).getResponse()).toEqual(notFoundBody());
    }
    expect(() => files.resolve(PROPERTY_A, '55555555-5555-4555-8555-555555555555')).toThrow(NotFoundException);
  });
});
