import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;

/** Shared app-role client. Null when DATABASE_URL is unset. Tests use this too. */
export function database(): PrismaClient | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  client ??= new PrismaClient();
  return client;
}
