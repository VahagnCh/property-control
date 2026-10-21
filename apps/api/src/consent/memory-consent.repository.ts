import { ConsentRow, ConsentRepository, UniqueConsentError } from './consent.repository.js';

export class MemoryConsentRepository implements ConsentRepository {
  private readonly rows = new Map<string, ConsentRow>();

  async find(userId: string, avisoVersion: string): Promise<ConsentRow | null> {
    return this.rows.get(key(userId, avisoVersion)) ?? null;
  }

  async insert(row: ConsentRow): Promise<ConsentRow> {
    await Promise.resolve();
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
