import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const PAYMENT_ID = '44444444-4444-4444-8444-444444444444';
const OBLIGATION_ID = '33333333-3333-4333-8333-333333333333';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const INVITE_ID = '66666666-6666-4666-8666-666666666666';

function listRoutes(app: INestApplication): string[] {
  const server = app.getHttpAdapter().getInstance() as {
    router?: { stack: RouteLayer[] };
    _router?: { stack: RouteLayer[] };
  };
  const stack = server.router?.stack ?? server._router?.stack ?? [];
  return walk(stack).sort();
}

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: RouteLayer[] };
  path?: string;
  regexp?: { fast_slash?: boolean };
}

function layerPath(layer: RouteLayer): string {
  if (typeof layer.path === 'string') {
    return layer.path;
  }
  return '';
}

function walk(stack: RouteLayer[], prefix = ''): string[] {
  const routes: string[] = [];
  for (const layer of stack) {
    if (layer.route) {
      const path = `${prefix}${layer.route.path}`.replaceAll(/\/{2,}/g, '/');
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled && method !== '_all') {
          routes.push(`${method.toUpperCase()} ${path}`);
        }
      }
      continue;
    }
    if (layer.handle?.stack) {
      const segment = layerPath(layer);
      const next = segment && segment !== '/' ? `${prefix}${segment}` : prefix;
      routes.push(...walk(layer.handle.stack, next));
    }
  }
  return routes;
}

describe('API scaffold', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/properties requires an access token', async () => {
    const response = await request(app.getHttpServer()).get('/v1/properties').expect(401);
    expect(response.body.error).toBe('token_missing');
  });

  it('POST /v1/properties/:id/payments requires an access token', async () => {
    const server = app.getHttpServer();
    await request(server).post('/v1/properties/property-1/payments').send({ amount: '100.00' }).expect(400);
    await request(server)
      .post(`/v1/properties/${PROPERTY_ID}/payments`)
      .send({ amount: '100.00' })
      .expect(401);
  });

  it('has no payment DELETE route and exposes void, resume, and invites as 501', async () => {
    const server = app.getHttpServer();
    await request(server).delete('/v1/properties/property-1/payments/payment-1').expect(400);
    await request(server).post('/v1/properties/property-1/payments/payment-1/void').expect(400);
    await request(server).post('/v1/properties/property-1/obligations/obligation-1/resume').expect(400);
    await request(server).post('/v1/properties/property-1/obligations/obligation-1/unarchive').expect(400);
    await request(server).post('/v1/properties/property-1/memberships').expect(400);
    await request(server).get('/v1/properties/property-1/invites').expect(400);
    await request(server).post('/v1/properties/property-1/invites').expect(400);
    await request(server).post('/v1/properties/property-1/invites/invite-1/resend').expect(400);
    await request(server).delete('/v1/properties/property-1/invites/invite-1').expect(400);

    await request(server).delete(`/v1/properties/${PROPERTY_ID}/payments/${PAYMENT_ID}`).expect(404);
    await request(server).post(`/v1/properties/${PROPERTY_ID}/payments/${PAYMENT_ID}/void`).expect(501);
    await request(server)
      .post(`/v1/properties/${PROPERTY_ID}/obligations/${OBLIGATION_ID}/resume`)
      .expect(501);
    await request(server)
      .post(`/v1/properties/${PROPERTY_ID}/obligations/${OBLIGATION_ID}/unarchive`)
      .expect(501);
    await request(server).post(`/v1/properties/${PROPERTY_ID}/memberships`).expect(404);
    await request(server).get(`/v1/properties/${PROPERTY_ID}/invites`).expect(200);
    await request(server).post(`/v1/properties/${PROPERTY_ID}/invites`).expect(501);
    await request(server).post(`/v1/properties/${PROPERTY_ID}/invites/${INVITE_ID}/resend`).expect(501);
    await request(server).delete(`/v1/properties/${PROPERTY_ID}/invites/${INVITE_ID}`).expect(501);
    await request(server).post('/v1/invites/accept').expect(501);
  });

  it('maps the route count stated in the docs', () => {
    const routes = listRoutes(app);
    const stated = ['docs/API.md', 'docs/ARCHITECTURE.md', 'README.md', 'apps/api/README.md'].map((path) => {
      const match = readFileSync(resolve(repoRoot, path), 'utf8').match(/maps \*\*(\d+)\*\* routes/);
      expect(match, path).not.toBeNull();
      return Number(match?.[1]);
    });
    expect(new Set(stated).size).toBe(1);
    expect(routes).toHaveLength(stated[0] ?? -1);
  });

  it('GET content-url does not return an object URL', async () => {
    const server = app.getHttpServer();
    await request(server).get('/v1/properties/property-1/documents/document-1/content-url').expect(400);
    const response = await request(server)
      .get(`/v1/properties/${PROPERTY_ID}/documents/${DOCUMENT_ID}/content-url`)
      .expect(501);
    expect(JSON.stringify(response.body)).not.toMatch(/https?:\/\//);
    expect(response.body).not.toHaveProperty('storageKey');
    expect(JSON.stringify(response.body)).not.toMatch(/storageKey|storage_key/i);
  });

  it('OCR routes return 501 when the flag is off, including a non-UUID id, and hide storageKey', async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/v1/properties/property-1/documents/document-1/ocr-jobs')
      .send({ storageKey: 'properties/secret/documents/deed', admin: true })
      .expect(501);
    expect(created.body.module).toBe('ocr');
    expect(created.body.error).toBe('ocr_disabled');
    expect(created.body).not.toHaveProperty('storageKey');
    expect(JSON.stringify(created.body)).not.toMatch(/storageKey|storage_key|properties\//i);

    const encoded = await request(server)
      .post('/v1/properties/%2e%2e%2f/documents/%252e%252e%252f/ocr-jobs')
      .expect(501);
    expect(JSON.stringify(encoded.body)).not.toMatch(/storageKey|storage_key/i);
  });
});
