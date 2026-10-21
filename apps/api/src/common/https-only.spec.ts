import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { enforceHttps, hstsHeader, HSTS_MIN_MAX_AGE } from './https-only.js';

function buildApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(enforceHttps);
  app.get('/v1/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.post('/v1/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/v1/me', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('enforceHttps', () => {
  const previous = process.env.NODE_ENV;
  const previousAge = process.env.HSTS_MAX_AGE;
  const previousInclude = process.env.HSTS_INCLUDE_SUBDOMAINS;
  const previousPreload = process.env.HSTS_PRELOAD;

  afterEach(() => {
    process.env.NODE_ENV = previous;
    restore('HSTS_MAX_AGE', previousAge);
    restore('HSTS_INCLUDE_SUBDOMAINS', previousInclude);
    restore('HSTS_PRELOAD', previousPreload);
  });

  it('does nothing outside production', async () => {
    process.env.NODE_ENV = 'test';
    const response = await request(buildApp()).get('/v1/me');
    expect(response.status).toBe(200);
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('lets a header-less GET /v1/health through with status and no HSTS', async () => {
    process.env.NODE_ENV = 'production';
    const response = await request(buildApp()).get('/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('rejects a missing proto on every other route', async () => {
    process.env.NODE_ENV = 'production';
    const app = buildApp();
    const other = await request(app).get('/v1/me');
    expect(other.status).toBe(403);
    expect(other.body).toEqual({
      statusCode: 403,
      error: 'https_required',
      message: 'HTTPS is required.',
    });
    expect(other.headers['strict-transport-security']).toBeUndefined();
    const posted = await request(app).post('/v1/health');
    expect(posted.status).toBe(403);
    expect(posted.headers['strict-transport-security']).toBeUndefined();
  });

  it('rejects HTTP, ws, and a rightmost http', async () => {
    process.env.NODE_ENV = 'production';
    const app = buildApp();
    for (const proto of ['http', 'HTTP', 'ws', 'https, http']) {
      const response = await request(app).get('/v1/me').set('X-Forwarded-Proto', proto);
      expect(response.status, proto).toBe(403);
      expect(response.body.error).toBe('https_required');
      expect(response.headers['strict-transport-security']).toBeUndefined();
    }
  });

  it('accepts a rightmost https and sets HSTS without includeSubDomains', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.HSTS_INCLUDE_SUBDOMAINS;
    delete process.env.HSTS_PRELOAD;
    const app = buildApp();
    for (const proto of ['https', 'HTTPS', 'http, https']) {
      const response = await request(app).get('/v1/me').set('X-Forwarded-Proto', proto);
      expect(response.status, proto).toBe(200);
      expect(response.headers['strict-transport-security']).toBe(`max-age=${HSTS_MIN_MAX_AGE}`);
    }
    const health = await request(app).get('/v1/health').set('X-Forwarded-Proto', 'https');
    expect(health.body).toEqual({ status: 'ok' });
    expect(health.headers['strict-transport-security']).toBe(`max-age=${HSTS_MIN_MAX_AGE}`);
  });

  it('raises a short max-age and adds includeSubDomains only when asked', () => {
    expect(hstsHeader({ HSTS_MAX_AGE: '60' })).toBe(`max-age=${HSTS_MIN_MAX_AGE}`);
    expect(hstsHeader({ HSTS_MAX_AGE: '63072000', HSTS_INCLUDE_SUBDOMAINS: 'true' })).toBe(
      'max-age=63072000; includeSubDomains',
    );
    expect(
      hstsHeader({ HSTS_INCLUDE_SUBDOMAINS: 'true', HSTS_PRELOAD: 'true' }),
    ).toBe(`max-age=${HSTS_MIN_MAX_AGE}; includeSubDomains; preload`);
    expect(hstsHeader({ HSTS_PRELOAD: 'true' })).toBe(`max-age=${HSTS_MIN_MAX_AGE}`);
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
