import { randomUUID } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import type { AvisoConfig } from './aviso-config.js';
import {
  ConsentAuditLog,
  ConsentRepository,
  ConsentRow,
  UniqueConsentError,
} from './consent.repository.js';

export interface ConsentClock {
  now(): Date;
}

export interface RecordConsentInput {
  userId: string;
  avisoVersion: string;
  appVersion?: string | null;
}

export interface RecordConsentResult {
  outcome: 'created' | 'existing';
  consent: ConsentRow;
}

export class ConsentService {
  constructor(
    private readonly repo: ConsentRepository,
    private readonly audit: ConsentAuditLog,
    private readonly getConfig: () => AvisoConfig,
    private readonly clock: ConsentClock,
  ) {}

  async hasCurrentConsent(userId: string, currentAvisoVersion: string): Promise<boolean> {
    const row = await this.repo.find(userId, currentAvisoVersion);
    return row !== null;
  }

  async consentState(userId: string): Promise<{ required: boolean; avisoVersion: string; avisoUrl: string }> {
    const config = this.getConfig();
    const required = !(await this.hasCurrentConsent(userId, config.avisoVersion));
    return { required, avisoVersion: config.avisoVersion, avisoUrl: config.avisoUrl };
  }

  async recordConsent(input: RecordConsentInput): Promise<RecordConsentResult> {
    const current = this.getConfig().avisoVersion;
    if (input.avisoVersion !== current) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'aviso_version_mismatch',
        message: 'avisoVersion does not match the current aviso.',
      });
    }
    const appVersion = input.appVersion ?? null;
    const existing = await this.repo.find(input.userId, input.avisoVersion);
    if (existing) {
      await this.writeAudit(existing, appVersion);
      return { outcome: 'existing', consent: existing };
    }
    const now = this.clock.now();
    const row: ConsentRow = {
      id: randomUUID(),
      userId: input.userId,
      avisoVersion: input.avisoVersion,
      acceptedAt: now,
      appVersion,
      createdAt: now,
    };
    try {
      const created = await this.repo.insert(row);
      await this.writeAudit(created, appVersion);
      return { outcome: 'created', consent: created };
    } catch (error) {
      if (!(error instanceof UniqueConsentError)) {
        throw error;
      }
      const winner = await this.repo.find(input.userId, input.avisoVersion);
      if (!winner) {
        throw error;
      }
      await this.writeAudit(winner, appVersion);
      return { outcome: 'existing', consent: winner };
    }
  }

  private async writeAudit(row: ConsentRow, appVersion: string | null): Promise<void> {
    await this.audit.append({
      action: 'consent.accepted',
      userId: row.userId,
      avisoVersion: row.avisoVersion,
      appVersion,
      consentId: row.id,
    });
  }
}
