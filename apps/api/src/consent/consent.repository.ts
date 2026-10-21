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

/** Append-only. Callers insert and find. There is no update or delete. */
export interface ConsentRepository {
  find(userId: string, avisoVersion: string): Promise<ConsentRow | null>;
  insert(row: ConsentRow): Promise<ConsentRow>;
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
