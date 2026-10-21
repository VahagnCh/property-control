import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { HEALTH_LIMITER, HEALTH_PROBE, PrismaHealthProbe } from '../src/health/live-health.controller.js';
import { HEALTH_LIMIT_TOKENS, HealthRateLimiter, type HealthProbe } from '../src/health/live-health.js';

async function boot(probe: HealthProbe): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(HEALTH_PROBE)
    .useValue(probe)
    .overrideProvider(HEALTH_LIMITER)
    .useValue(new HealthRateLimiter())
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

describe('GET /v1/health', () => {
  it('returns only status ok when the database answers', async () => {
    const app = await boot({ ping: async () => undefined });
    try {
      const response = await request(app.getHttpServer()).get('/v1/health').expect(200);
      expect(response.body).toEqual({ status: 'ok' });
      expect(Object.keys(response.body)).toEqual(['status']);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });

  it('returns only status unavailable when the database fails', async () => {
    const app = await boot({
      ping: () => Promise.reject(new Error('postgres://secret@db/property_control')),
    });
    try {
      const response = await request(app.getHttpServer()).get('/v1/health').expect(503);
      expect(response.body).toEqual({ status: 'unavailable' });
      expect(Object.keys(response.body)).toEqual(['status']);
      expect(JSON.stringify(response.body)).not.toMatch(/secret|postgres|timeout/i);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });

  it('returns 429 and Retry-After after 30 requests from one IP', async () => {
    const app = await boot({ ping: async () => undefined });
    try {
      const server = app.getHttpServer();
      for (let i = 0; i < HEALTH_LIMIT_TOKENS; i += 1) {
        const response = await request(server).get('/v1/health');
        expect(response.status, `request ${i + 1}`).toBe(200);
        expect(response.body).toEqual({ status: 'ok' });
      }
      const blocked = await request(server).get('/v1/health');
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toMatch(/^[1-9]\d*$/);
      expect(blocked.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(blocked.body)).not.toMatch(/postgres|secret/i);
    } finally {
      await app.close();
    }
  });

  it('does not let a spoofed leftmost X-Forwarded-For mint a new bucket', async () => {
    const app = await boot({ ping: async () => undefined });
    try {
      const server = app.getHttpServer();
      for (let i = 0; i < HEALTH_LIMIT_TOKENS; i += 1) {
        const response = await request(server).get('/v1/health').set('X-Forwarded-For', '203.0.113.9');
        expect(response.status, `request ${i + 1}`).toBe(200);
      }
      const spoofed = await request(server)
        .get('/v1/health')
        .set('X-Forwarded-For', '198.51.100.50, 203.0.113.9');
      expect(spoofed.status).toBe(429);
    } finally {
      await app.close();
    }
  });
});

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
describe.skipIf(!databaseUrl || !directUrl)('GET /v1/health against Postgres', () => {
  let app: INestApplication;
  const probe = new PrismaHealthProbe();

  afterAll(async () => {
    await app?.close();
    await probe.disconnect();
  });

  it('runs SELECT 1', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(HEALTH_PROBE)
      .useValue(probe)
      .overrideProvider(HEALTH_LIMITER)
      .useValue(new HealthRateLimiter())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    const response = await request(app.getHttpServer()).get('/v1/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(Object.keys(response.body)).toEqual(['status']);
  });
});
