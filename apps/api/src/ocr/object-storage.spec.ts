import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { PrivateObjectStorage } from './object-storage.js';

describe('private object storage', () => {
  it('rejects a bad id as invalid_source_key and does not say storage key', () => {
    const storage = new PrivateObjectStorage();
    try {
      storage.buildOcrSourceKey('not-a-uuid', '22222222-2222-4222-8222-111111111111');
      throw new Error('expected a bad request');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse();
      expect(body).toEqual({
        statusCode: 400,
        error: 'invalid_source_key',
        message: 'Invalid source key input.',
      });
      expect(JSON.stringify(body)).not.toMatch(/storage[_-]?key/i);
    }
    expect(storage.calls).toEqual([]);
  });
});
