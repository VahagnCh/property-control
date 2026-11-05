import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { readRuntimeRole } from './auth/runtime-role.js';
import { prepareBoot } from './boot.js';
import { RedactingLogger } from './common/redacting-logger.js';
import { configureApp } from './configure-app.js';
import { createPrismaClient } from './persistence/prisma-client.js';

async function bootstrap(): Promise<void> {
  const prisma = createPrismaClient();
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
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: new RedactingLogger() });
  configureApp(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
