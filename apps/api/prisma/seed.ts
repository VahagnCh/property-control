import { PrismaClient } from '@prisma/client';
import { seedDatabase } from '../src/persistence/seed-data.js';

const prisma = new PrismaClient();
try {
  await seedDatabase(prisma, process.env);
} finally {
  await prisma.$disconnect();
}
