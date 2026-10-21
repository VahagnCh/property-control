import { RequestMethod, type INestApplication } from '@nestjs/common';
import { corsOriginOption, parseCorsOrigins } from './common/cors-origins.js';
import { UuidPathInterceptor } from './common/uuid-path.interceptor.js';

export function configureApp(
  app: INestApplication,
  options?: { corsOrigins?: readonly string[] },
): INestApplication {
  app.setGlobalPrefix('v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  const origins = options?.corsOrigins ?? parseCorsOrigins(process.env.CORS_ORIGINS);
  app.enableCors({ origin: corsOriginOption(origins) });
  app.useGlobalInterceptors(new UuidPathInterceptor());
  app.enableShutdownHooks();
  return app;
}
