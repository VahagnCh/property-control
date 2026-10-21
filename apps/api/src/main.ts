import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { readRuntimeRole } from './auth/runtime-role.js';
import { prepareBoot } from './boot.js';
import { configureApp } from './configure-app.js';

async function bootstrap(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prepareBoot(process.env, {
      runtimeRole: () => readRuntimeRole(prisma),
      avisoPublished: async (version) => {
        const row = await prisma.avisoVersion.findUnique({
          where: { version },
          select: { version: true },
        });
        return row !== null;
      },
    });
  } finally {
    await prisma.$disconnect();
  }
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
