import type { PrismaClient } from '@prisma/client';

export const CONSENT_GATE = Symbol('CONSENT_GATE');

export interface ConsentGate {
  hasCurrent(userId: string): Promise<boolean>;
}

/** True only when this user has a row for the configured aviso version. */
export class PrismaConsentGate implements ConsentGate {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly avisoVersion: string,
  ) {}

  async hasCurrent(userId: string): Promise<boolean> {
    const row = await this.prisma.consent.findUnique({
      where: { userId_avisoVersion: { userId, avisoVersion: this.avisoVersion } },
      select: { id: true },
    });
    return row !== null;
  }
}

/** Test double. Production uses {@link PrismaConsentGate}. */
export class FixedConsentGate implements ConsentGate {
  constructor(private readonly allowed: boolean) {}

  hasCurrent(): Promise<boolean> {
    return Promise.resolve(this.allowed);
  }
}

export function avisoVersionFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const version = env.AVISO_VERSION?.trim() ?? '';
  return version.length > 0 ? version : '2026-10-21';
}
