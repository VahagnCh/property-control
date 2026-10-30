import { Module } from '@nestjs/common';
import { MemoryIdempotencyKeys, PrismaIdempotencyKeys, type IdempotencyStore } from '../auth/idempotency-keys.js';
import { database } from '../persistence/database.js';
import { RecordsService } from './records.service.js';

export const RECORDS_PRISMA = Symbol('RECORDS_PRISMA');
export const RECORDS_IDEMPOTENCY = Symbol('RECORDS_IDEMPOTENCY');

@Module({
  providers: [
    {
      provide: RECORDS_PRISMA,
      useFactory: () => database(),
    },
    {
      provide: RECORDS_IDEMPOTENCY,
      useFactory: (): IdempotencyStore => {
        const prisma = database();
        return prisma ? new PrismaIdempotencyKeys(prisma) : new MemoryIdempotencyKeys();
      },
    },
    {
      provide: RecordsService,
      useFactory: (prisma: ReturnType<typeof database>, keys: IdempotencyStore) => new RecordsService(prisma, keys),
      inject: [RECORDS_PRISMA, RECORDS_IDEMPOTENCY],
    },
  ],
  exports: [RecordsService],
})
export class RecordsModule {}
