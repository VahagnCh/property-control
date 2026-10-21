import { Injectable } from '@nestjs/common';
import { documentSourceKey, storageEnvFromConfig } from '../evidence/storage-key.js';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface ObjectStorage {
  buildOcrSourceKey(): string;
}

/**
 * Private document key for the OCR stub. The property id stays on the row.
 * The key is never copied onto an OCR response.
 */
@Injectable()
export class PrivateObjectStorage implements ObjectStorage {
  readonly calls: string[] = [];

  constructor(private readonly config: NodeJS.ProcessEnv = process.env) {}

  buildOcrSourceKey(): string {
    const key = documentSourceKey(storageEnvFromConfig(this.config));
    this.calls.push(key);
    return key;
  }
}
