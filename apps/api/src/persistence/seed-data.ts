import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AVISO_TEXT } from '../consent/aviso-text.js';
import { loadAvisoConfig } from '../consent/aviso-config.js';

export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_PROPERTY_ID = '00000000-0000-4000-8000-000000000002';
export const DEMO_OBLIGATION_ID = '00000000-0000-4000-8000-000000000003';
export const DEMO_MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000004';

export async function seedDatabase(prisma: PrismaClient, env: NodeJS.ProcessEnv): Promise<void> {
  const aviso = loadAvisoConfig(env);
  const textSha256 = createHash('sha256').update(AVISO_TEXT, 'utf8').digest('hex');
  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    create: { id: DEMO_USER_ID, trustSub: 'demo', displayName: 'Demo' },
    update: { trustSub: 'demo', displayName: 'Demo' },
  });
  await prisma.property.upsert({
    where: { id: DEMO_PROPERTY_ID },
    create: { id: DEMO_PROPERTY_ID, name: 'Casa', timezone: 'America/Mexico_City' },
    update: { name: 'Casa', timezone: 'America/Mexico_City' },
  });
  await prisma.propertyMembership.upsert({
    where: { id: DEMO_MEMBERSHIP_ID },
    create: {
      id: DEMO_MEMBERSHIP_ID,
      propertyId: DEMO_PROPERTY_ID,
      userId: DEMO_USER_ID,
      role: 'owner',
      status: 'active',
    },
    update: { role: 'owner', status: 'active' },
  });
  await prisma.obligation.upsert({
    where: { id: DEMO_OBLIGATION_ID },
    create: {
      id: DEMO_OBLIGATION_ID,
      propertyId: DEMO_PROPERTY_ID,
      category: 'electricity',
      title: 'CFE',
      recurrence: 'monthly',
      dueDay: 15,
      scheduleAnchor: new Date('2026-10-01T00:00:00.000Z'),
      nextDueDate: new Date('2026-10-15T00:00:00.000Z'),
      expectedAmount: 85000,
      currency: 'MXN',
    },
    update: {
      title: 'CFE',
      expectedAmount: 85000,
      dueDay: 15,
    },
  });
  await prisma.avisoVersion.upsert({
    where: { version: aviso.avisoVersion },
    create: {
      version: aviso.avisoVersion,
      url: aviso.avisoUrl,
      textSha256,
    },
    update: { url: aviso.avisoUrl, textSha256 },
  });
}
