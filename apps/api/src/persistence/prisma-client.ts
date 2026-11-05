import { PrismaClient } from '@prisma/client';
import { logError } from '../common/log-redaction.js';

/**
 * Prisma client whose error and warn events go through the redactor.
 * Query logging stays off. The URL is DATABASE_URL only.
 */
export function createPrismaClient(options?: { datasourceUrl?: string }): PrismaClient {
  const client = new PrismaClient({
    ...(options?.datasourceUrl ? { datasourceUrl: options.datasourceUrl } : {}),
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });
  client.$on('error', (event) => {
    logError(event.message);
  });
  client.$on('warn', (event) => {
    logError(event.message);
  });
  return client;
}
