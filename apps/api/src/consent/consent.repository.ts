export interface ConsentRow {
  id: string;
  userId: string;
  avisoVersion: string;
  acceptedAt: Date;
  appVersion: string | null;
  createdAt: Date;
}

export class UniqueConsentError extends Error {
  constructor() {
    super('consent already exists');
    this.name = 'UniqueConsentError';
  }
}

/** The published aviso row is missing. Callers turn this into 422, not a Prisma error. */
export class AvisoVersionMissingError extends Error {
  constructor() {
    super('aviso version is not published');
    this.name = 'AvisoVersionMissingError';
  }
}

/** Append-only. Callers find and accept. There is no update or delete. */
export interface ConsentRepository {
  find(userId: string, avisoVersion: string): Promise<ConsentRow | null>;
  insert(row: ConsentRow): Promise<ConsentRow>;
  /**
   * Insert the consent and its audit entry together. If the audit write
   * fails, the consent row is not kept. A duplicate is UniqueConsentError.
   * A missing aviso version is AvisoVersionMissingError.
   */
  acceptAtomic(row: ConsentRow, entry: ConsentAuditEntry, audit: ConsentAuditLog): Promise<ConsentRow>;
}

export interface ConsentAuditEntry {
  action: 'consent.accepted';
  userId: string;
  avisoVersion: string;
  appVersion: string | null;
  consentId: string;
}

export interface ConsentAuditLog {
  append(entry: ConsentAuditEntry): Promise<void>;
}
