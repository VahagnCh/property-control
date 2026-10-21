import { Inject, Injectable, Optional } from '@nestjs/common';
import { documentSourceKey, storageEnvFromConfig } from '../evidence/storage-key.js';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** Optional env override. Unset means `process.env`, including OBJECT_STORAGE_ENV. */
export const OBJECT_STORAGE_ENV_CONFIG = Symbol('OBJECT_STORAGE_ENV_CONFIG');

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
  private readonly config: NodeJS.ProcessEnv;

  constructor(@Optional() @Inject(OBJECT_STORAGE_ENV_CONFIG) config?: NodeJS.ProcessEnv) {
    this.config = config ?? process.env;
  }

  buildOcrSourceKey(): string {
    const key = documentSourceKey(storageEnvFromConfig(this.config));
    this.calls.push(key);
    return key;
  }
}
