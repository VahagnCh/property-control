import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AvisoConfig } from './aviso-config.js';
import { ConsentService } from './consent.service.js';
import { AvisoVersionMissingError, type ConsentAuditEntry, type ConsentRepository } from './consent.repository.js';
import { MemoryConsentRepository } from './memory-consent.repository.js';
import { PrismaConsentRepository } from './prisma-consent.repository.js';

function harness(version = '2026-10-21') {
  const repo = new MemoryConsentRepository();
  const audits: ConsentAuditEntry[] = [];
  const config: AvisoConfig = { avisoVersion: version, avisoUrl: 'https://example.com/aviso' };
  let now = new Date('2026-10-21T18:00:00.000Z');
  const service = new ConsentService(
    repo,
    { append: async (entry) => { audits.push(entry); } },
    () => config,
    { now: () => now },
  );
  return {
    service,
    repo,
    audits,
    config,
    setNow(value: Date) {
      now = value;
    },
  };
}

describe('ConsentService', () => {
  it('exposes no update or delete on the repositories', () => {
    for (const proto of [MemoryConsentRepository.prototype, PrismaConsentRepository.prototype]) {
      expect(Object.getOwnPropertyNames(proto).join(' ')).not.toMatch(/update|delete|remove|upsert/i);
    }
  });

  it('inserts the first accept and returns the same row on a repeat', async () => {
    const { service, repo, audits, setNow } = harness();
    const first = await service.recordConsent({
      userId: 'user-1',
      avisoVersion: '2026-10-21',
      appVersion: '1.0.0',
    });
    expect(first.outcome).toBe('created');
    setNow(new Date('2026-11-01T18:00:00.000Z'));
    const second = await service.recordConsent({
      userId: 'user-1',
      avisoVersion: '2026-10-21',
      appVersion: '2.0.0',
    });
    expect(second.outcome).toBe('existing');
    expect(second.consent).toEqual(first.consent);
    expect(second.consent.acceptedAt.toISOString()).toBe('2026-10-21T18:00:00.000Z');
    expect(second.consent.appVersion).toBe('1.0.0');
    expect(await repo.find('user-1', '2026-10-21')).toEqual(first.consent);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'consent.accepted', appVersion: '1.0.0', consentId: first.consent.id });
  });

  it('rolls the consent row back when the audit write fails', async () => {
    const repo = new MemoryConsentRepository();
    const config = { avisoVersion: '2026-10-21', avisoUrl: 'https://example.com/aviso' };
    const service = new ConsentService(
      repo,
      {
        append: async () => {
          throw new Error('audit failed');
        },
      },
      () => config,
      { now: () => new Date('2026-10-21T18:00:00.000Z') },
    );
    await expect(
      service.recordConsent({ userId: 'user-1', avisoVersion: '2026-10-21', appVersion: '1.0.0' }),
    ).rejects.toThrow(/audit failed/);
    expect(await repo.find('user-1', '2026-10-21')).toBeNull();
  });

  it('turns a missing aviso version into a server fault', async () => {
    const repo: ConsentRepository = {
      find: async () => null,
      insert: async () => {
        throw new Error('unused');
      },
      acceptAtomic: async () => {
        throw new AvisoVersionMissingError();
      },
    };
    const service = new ConsentService(
      repo,
      { append: async () => undefined },
      () => ({ avisoVersion: '2026-10-21', avisoUrl: 'https://example.com/aviso' }),
      { now: () => new Date('2026-10-21T18:00:00.000Z') },
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await service.recordConsent({ userId: 'user-1', avisoVersion: '2026-10-21' });
      throw new Error('expected aviso_unavailable');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        statusCode: 503,
        error: 'aviso_unavailable',
        message: 'The current aviso version is not available.',
      });
      expect(error).not.toBeInstanceOf(AvisoVersionMissingError);
      const alerts = spy.mock.calls.filter((call) => String(call[0]).includes('aviso_unavailable'));
      expect(alerts).toEqual([['alert: aviso_unavailable']]);
      expect(JSON.stringify(alerts)).not.toContain('user-1');
      expect(JSON.stringify(alerts)).not.toContain('@');
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects an older or other version before insert', async () => {
    const { service, repo } = harness('2026-10-21');
    await expect(service.recordConsent({ userId: 'user-1', avisoVersion: '2026-01-01' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    try {
      await service.recordConsent({ userId: 'user-1', avisoVersion: '2026-01-01' });
    } catch (error) {
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        statusCode: 422,
        error: 'aviso_version_mismatch',
      });
    }
    expect(await repo.find('user-1', '2026-01-01')).toBeNull();
  });

  it('requires consent again after the published version changes', async () => {
    const { service, config } = harness('v1');
    await service.recordConsent({ userId: 'user-1', avisoVersion: 'v1' });
    expect(await service.hasCurrentConsent('user-1', 'v1')).toBe(true);
    config.avisoVersion = 'v2';
    config.avisoUrl = 'https://example.com/aviso-v2';
    expect(await service.hasCurrentConsent('user-1', 'v2')).toBe(false);
    expect(await service.consentState('user-1')).toEqual({
      required: true,
      avisoVersion: 'v2',
      avisoUrl: 'https://example.com/aviso-v2',
    });
    expect(await service.hasCurrentConsent('user-1', 'v1')).toBe(true);
  });

  it('keeps a single row when two accepts race', async () => {
    const { service, repo, audits } = harness();
    const [left, right] = await Promise.all([
      service.recordConsent({ userId: 'user-1', avisoVersion: '2026-10-21', appVersion: 'a' }),
      service.recordConsent({ userId: 'user-1', avisoVersion: '2026-10-21', appVersion: 'b' }),
    ]);
    expect(left.consent.id).toBe(right.consent.id);
    expect(left.consent.acceptedAt.toISOString()).toBe(right.consent.acceptedAt.toISOString());
    expect(await repo.find('user-1', '2026-10-21')).toMatchObject({ id: left.consent.id });
    expect(audits).toHaveLength(1);
  });
});
