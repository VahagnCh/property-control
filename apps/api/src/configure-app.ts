import { RequestMethod, type INestApplication } from '@nestjs/common';
import { corsOriginOption, parseCorsOrigins } from './common/cors-origins.js';
import { enforceHttps } from './common/https-only.js';
import { NotFoundFilter } from './common/not-found.filter.js';
import { UuidPathInterceptor } from './common/uuid-path.interceptor.js';

export function configureApp(
  app: INestApplication,
  options?: { corsOrigins?: readonly string[] },
): INestApplication {
  app.setGlobalPrefix('v1', {
    exclude: [{ path: 'v1/health', method: RequestMethod.GET }],
  });
  // One trusted hop, matching Render. req.ip and req.protocol are what that hop saw.
  const adapter = app.getHttpAdapter().getInstance() as { set?: (key: string, value: number) => void };
  adapter.set?.('trust proxy', 1);
  app.use(enforceHttps);
  const origins = options?.corsOrigins ?? parseCorsOrigins(process.env.CORS_ORIGINS);
  app.enableCors({ origin: corsOriginOption(origins) });
  app.useGlobalInterceptors(new UuidPathInterceptor());
  app.useGlobalFilters(new NotFoundFilter());
  app.enableShutdownHooks();
  return app;
}
