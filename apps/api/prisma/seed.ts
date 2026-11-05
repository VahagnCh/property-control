import { PrismaClient } from '@prisma/client';
import { seedFromEnv } from '../src/persistence/seed-data.js';

const prisma = new PrismaClient();
try {
  await seedFromEnv(prisma, process.env);
} finally {
  await prisma.$disconnect();
}
