import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadAvisoConfig } from './consent/aviso-config.js';
import { configureApp } from './configure-app.js';

async function bootstrap(): Promise<void> {
  loadAvisoConfig(process.env);
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
