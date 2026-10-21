import { randomUUID } from 'node:crypto';
import { notFoundException } from '../common/not-found.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Public handle. The storage key is not on this object. */
export interface IssuedFile {
  fileId: string;
}

interface PrivateFile {
  fileId: string;
  propertyId: string;
  sourceKey: string;
}

/**
 * fileId is an opaque v4 UUID from crypto.randomUUID. It is not derived from
 * the storage key or any object path. Resolution is property-scoped: a foreign
 * or unknown id is 404. Callers still run the membership guard before this.
 */
export class PropertyFileIds {
  private readonly files = new Map<string, PrivateFile>();

  issue(propertyId: string): IssuedFile {
    const fileId = randomUUID();
    const sourceKey = `properties/${propertyId}/evidence/${randomUUID()}/${randomUUID()}`;
    this.files.set(fileId, { fileId, propertyId, sourceKey });
    return { fileId };
  }

  resolve(propertyId: string, fileId: string): IssuedFile {
    const row = this.files.get(fileId);
    if (!row || row.propertyId !== propertyId) {
      throw notFoundException();
    }
    return { fileId: row.fileId };
  }

  /** Test-only. Production responses use issue() and resolve(). */
  sourceKey(fileId: string): string | undefined {
    return this.files.get(fileId)?.sourceKey;
  }
}

export function isOpaqueFileId(fileId: string): boolean {
  return UUID_V4.test(fileId) && !fileId.includes('/') && !fileId.includes('properties');
}
