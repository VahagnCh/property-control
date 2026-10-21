import {
  ConsentAuditEntry,
  ConsentAuditLog,
  ConsentRepository,
  ConsentRow,
  UniqueConsentError,
} from './consent.repository.js';

export class MemoryConsentRepository implements ConsentRepository {
  private readonly rows = new Map<string, ConsentRow>();

  async find(userId: string, avisoVersion: string): Promise<ConsentRow | null> {
    return this.rows.get(key(userId, avisoVersion)) ?? null;
  }

  async insert(row: ConsentRow): Promise<ConsentRow> {
    await Promise.resolve();
    return this.store(row);
  }

  async acceptAtomic(row: ConsentRow, entry: ConsentAuditEntry, audit: ConsentAuditLog): Promise<ConsentRow> {
    const stored = this.store(row);
    try {
      await audit.append(entry);
    } catch (error) {
      this.rows.delete(key(row.userId, row.avisoVersion));
      throw error;
    }
    return stored;
  }

  private store(row: ConsentRow): ConsentRow {
    const id = key(row.userId, row.avisoVersion);
    if (this.rows.has(id)) {
      throw new UniqueConsentError();
    }
    const stored = { ...row };
    this.rows.set(id, stored);
    return { ...stored };
  }
}

function key(userId: string, avisoVersion: string): string {
  return `${userId}\0${avisoVersion}`;
}
