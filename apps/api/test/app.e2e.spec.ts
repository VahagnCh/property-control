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
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'property-control-api',
    });
  });

  it('GET /v1/properties is an empty scaffold list', async () => {
    const response = await request(app.getHttpServer()).get('/v1/properties').expect(200);
    expect(response.body).toEqual({
      items: [],
      stub: true,
      module: 'properties',
    });
  });

  it('POST /v1/properties/:id/payments is not implemented', async () => {
    await request(app.getHttpServer())
      .post('/v1/properties/property-1/payments')
      .send({ amount: '100.00' })
      .expect(501);
  });

  it('has no payment DELETE route and exposes void, resume, and invites as 501', async () => {
    const server = app.getHttpServer();
    await request(server).delete('/v1/properties/property-1/payments/payment-1').expect(404);
    await request(server).post('/v1/properties/property-1/payments/payment-1/void').expect(501);
    await request(server).post('/v1/properties/property-1/obligations/obligation-1/resume').expect(501);
    await request(server)
      .post('/v1/properties/property-1/obligations/obligation-1/unarchive')
      .expect(501);
    await request(server).post('/v1/properties/property-1/memberships').expect(404);
    await request(server).get('/v1/properties/property-1/invites').expect(200);
    await request(server).post('/v1/properties/property-1/invites').expect(501);
    await request(server).post('/v1/properties/property-1/invites/invite-1/resend').expect(501);
    await request(server).delete('/v1/properties/property-1/invites/invite-1').expect(501);
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
    const response = await request(app.getHttpServer())
      .get('/v1/properties/property-1/documents/document-1/content-url')
      .expect(501);
    expect(JSON.stringify(response.body)).not.toMatch(/https?:\/\//);
  });

  it('OCR confirm is the only path that accepts suggestions', async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/v1/properties/property-1/documents/document-1/ocr-jobs')
      .expect(201);

    expect(created.body.status).toBe('suggested');
    expect(created.body.storageKey).not.toMatch(/https?:\/\//);

    const replay = await request(server)
      .post('/v1/properties/property-1/documents/document-1/ocr-jobs')
      .expect(200);
    expect(replay.body.id).toBe(created.body.id);

    const fetched = await request(server)
      .get(`/v1/properties/property-1/ocr-jobs/${created.body.id}`)
      .expect(200);
    expect(fetched.body.suggestions.every((row: { applyStatus: string }) => row.applyStatus === 'pending')).toBe(
      true,
    );

    const confirmed = await request(server)
      .post(`/v1/properties/property-1/ocr-jobs/${created.body.id}/confirm`)
      .send({
        decisions: fetched.body.suggestions.map(
          (row: { id: string; targetEntityType: string }) =>
            row.targetEntityType === 'document_meta'
              ? { suggestionId: row.id, action: 'accept' }
              : {
                  suggestionId: row.id,
                  action: 'accept',
                  targetEntityId: '00000000-0000-4000-8000-000000000001',
                },
        ),
      })
      .expect(200);

    expect(confirmed.body.persisted).toBe(false);
    expect(confirmed.body.job.status).toBe('confirmed');
    expect(confirmed.body.applied.length).toBe(fetched.body.suggestions.length);
  });
});
