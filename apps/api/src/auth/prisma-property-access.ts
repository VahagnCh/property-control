import type { PrismaClient } from '@prisma/client';
import type { PropertyAccess, ResolvedMembership } from './property-access.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Active membership on a property that is not soft-deleted. Anything else is unknown. */
export class PrismaPropertyAccess implements PropertyAccess {
  constructor(private readonly prisma: PrismaClient) {}

  async resolve(input: { userId: string; propertyId: string }): Promise<ResolvedMembership | null> {
    if (!UUID.test(input.userId) || !UUID.test(input.propertyId)) {
      return null;
    }
    const row = await this.prisma.propertyMembership.findFirst({
      where: {
        userId: input.userId,
        propertyId: input.propertyId,
        status: 'active',
        deletedAt: null,
        property: { deletedAt: null },
      },
      select: { role: true, userId: true },
    });
    if (!row) {
      return null;
    }
    if (row.role !== 'owner' && row.role !== 'member' && row.role !== 'viewer') {
      return null;
    }
    return { role: row.role, userId: row.userId };
  }

  documentBelongsToProperty(): boolean {
    return false;
  }
}
