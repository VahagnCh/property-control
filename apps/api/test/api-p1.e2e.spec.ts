import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessTokenGuard } from '../src/auth/access-token.guard.js';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
} from '../src/auth/access-token.verifier.js';
import { PROPERTY_ACCESS, type PropertyAccess } from '../src/auth/property-access.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { HEALTH_PROBE } from '../src/health/live-health.controller.js';
import { OCR_RUNTIME } from '../src/ocr/ocr-runtime.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const UUID = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const GUARDED_ROUTES = [
  'GET /v1/auth/session',
  'POST /v1/auth/logout',
  'GET /v1/properties/:propertyId/documents/:documentId/ocr-jobs',
  'GET /v1/properties/:propertyId/ocr-jobs/:ocrJobId',
  'POST /v1/properties/:propertyId/documents/:documentId/ocr-jobs',
  'POST /v1/properties/:propertyId/ocr-jobs/:ocrJobId/confirm',
];

const LIST_MODULES: Record<string, string> = {
  'GET /v1/properties': 'properties',
  'GET /v1/home/action-items': 'home',
  'GET /v1/properties/:id/memberships': 'memberships',
  'GET /v1/properties/:id/invites': 'invites',
  'GET /v1/properties/:id/obligations': 'obligations',
  'GET /v1/properties/:id/obligations/:id/period-outcomes': 'obligation-period-outcomes',
  'GET /v1/properties/:id/payments': 'payments',
  'GET /v1/properties/:id/evidence': 'evidence',
  'GET /v1/properties/:id/maintenance-tasks': 'maintenance',
  'GET /v1/properties/:id/documents': 'documents',
  'GET /v1/properties/:id/reminders': 'reminders',
  'GET /v1/properties/:id/audit-events': 'audit',
};

const FAMILIES = [
  'auth',
  'health',
  'me',
  'home',
  'properties',
  'memberships',
  'invites',
  'obligations',
  'payments',
  'evidence',
  'maintenance',
  'documents',
  'ocr',
  'reminders',
  'audit',
] as const;

type Family = (typeof FAMILIES)[number];

const TRAVERSAL = ['..%2F', '%2e%2e%2f', '%252e%252e%252f', '..%5C', '%00'];

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: RouteLayer[] };
  path?: string;
}

function canonical(route: string): string {
  const [method, rawPath = ''] = route.trim().split(/\s+/);
  const path = rawPath.split('?')[0]?.replace(/:[A-Za-z0-9_]+/g, ':id');
  return `${method} ${path}`;
}

function documentedRoutes(markdown: string): string[] {
  const found = new Set<string>();
  for (const line of markdown.split('\n')) {
    const match = line.match(/^(GET|POST|PATCH|DELETE|PUT)\s+(\/\S+)/);
    if (match?.[1] && match[2]) {
      found.add(canonical(`${match[1]} ${match[2]}`));
    }
  }
  if (markdown.includes('GET /health')) {
    found.add('GET /health');
  }
  return [...found].sort();
}

function listRoutes(app: INestApplication): string[] {
  const server = app.getHttpAdapter().getInstance() as {
    router?: { stack: RouteLayer[] };
    _router?: { stack: RouteLayer[] };
  };
  const stack = server.router?.stack ?? server._router?.stack ?? [];
  return walk(stack).sort();
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
      const segment = typeof layer.path === 'string' ? layer.path : '';
      const next = segment && segment !== '/' ? `${prefix}${segment}` : prefix;
      routes.push(...walk(layer.handle.stack, next));
    }
  }
  return routes;
}

function familyOf(path: string): Family {
  if (path === '/v1/auth' || path.startsWith('/v1/auth/')) return 'auth';
  if (path === '/v1/health' || path.startsWith('/v1/health/')) return 'health';
  if (path === '/v1/me' || path.startsWith('/v1/me/')) return 'me';
  if (path.includes('/home/')) return 'home';
  if (path.includes('/ocr-jobs')) return 'ocr';
  if (path.includes('/invites')) return 'invites';
  if (path.includes('/memberships')) return 'memberships';
  if (path.includes('/obligations')) return 'obligations';
  if (path.includes('/payments')) return 'payments';
  if (path.includes('/evidence')) return 'evidence';
  if (path.includes('/maintenance-tasks')) return 'maintenance';
  if (path.includes('/documents')) return 'documents';
  if (path.includes('/reminders')) return 'reminders';
  if (path.includes('/audit-events')) return 'audit';
  if (path.startsWith('/v1/properties')) return 'properties';
  throw new Error(`No route family for ${path}`);
}

function fill(path: string, id = UUID): string {
  return path.replace(/:[A-Za-z0-9_]+/g, id);
}

function spoilFirst(path: string, spoiler: string): string {
  let used = false;
  return path.replace(/:[A-Za-z0-9_]+/g, () => {
    if (used) return UUID;
    used = true;
    return spoiler;
  });
}

function isOcr(path: string): boolean {
  return path.includes('/ocr-jobs');
}

function isListTemplate(route: string): boolean {
  return Object.hasOwn(LIST_MODULES, canonical(route));
}

function expectNoSecret(body: unknown): void {
  const json = JSON.stringify(body);
  expect(json).not.toMatch(/storage[_-]?key/i);
  expect(json).not.toMatch(/https?:\/\//);
  expect(json).not.toMatch(/properties\/[0-9a-f-]{8,}\/(?:documents|evidence)\//i);
}

function methodName(method: number): string {
  const name = RequestMethod[method];
  if (!name || name === 'ALL') {
    throw new Error(`Unexpected HTTP method metadata ${method}`);
  }
  return name;
}

function joinPath(controllerPath: string, methodPath: string | undefined): string {
  const left = controllerPath.startsWith('/') ? controllerPath : `/${controllerPath}`;
  const right = !methodPath || methodPath === '/' ? '' : methodPath.startsWith('/') ? methodPath : `/${methodPath}`;
  const joined = `${left}${right}`.replaceAll(/\/{2,}/g, '/');
  if (joined === '/health' || joined.startsWith('/health/')) {
    return joined;
  }
  return `/v1${joined}`.replaceAll(/\/{2,}/g, '/');
}

function routesUsing(app: INestApplication, guard: new (...args: never[]) => unknown): string[] {
  const modules = app.get(ModulesContainer);
  const found: string[] = [];
  for (const nestModule of modules.values()) {
    for (const wrapper of nestModule.controllers.values()) {
      const metatype = wrapper.metatype;
      if (!metatype) continue;
      const controllerPaths = Reflect.getMetadata(PATH_METADATA, metatype) as string | string[] | undefined;
      const controllerGuards = (Reflect.getMetadata(GUARDS_METADATA, metatype) ?? []) as unknown[];
      const bases = Array.isArray(controllerPaths) ? controllerPaths : [controllerPaths ?? ''];
      for (const key of Object.getOwnPropertyNames(metatype.prototype as object)) {
        if (key === 'constructor') continue;
        const handler = (metatype.prototype as Record<string, unknown>)[key];
        if (typeof handler !== 'function') continue;
        const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (requestMethod === undefined) continue;
        const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[];
        const guards = [...controllerGuards, ...methodGuards];
        if (!guards.some((item) => item === guard)) continue;
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
        const paths = Array.isArray(methodPath) ? methodPath : [methodPath];
        for (const base of bases) {
          for (const path of paths) {
            found.push(`${methodName(requestMethod)} ${joinPath(base, path)}`);
          }
        }
      }
    }
  }
  return found.sort();
}

async function boot(options?: {
  enabled?: boolean;
  verifier?: AccessTokenVerifier;
  access?: PropertyAccess;
  corsOrigins?: string[];
}): Promise<INestApplication> {
  let builder: TestingModuleBuilder = Test.createTestingModule({ imports: [AppModule] });
  builder = builder.overrideProvider(HEALTH_PROBE).useValue({
    ping: () => Promise.reject(new Error('down')),
  });
  if (options?.enabled !== undefined) {
    builder = builder.overrideProvider(OCR_RUNTIME).useValue({
      enabled: options.enabled,
      jobsMax: 50,
      jobTtlMs: 900_000,
    });
  }
  if (options?.verifier) {
    builder = builder.overrideProvider(ACCESS_TOKEN_VERIFIER).useValue(options.verifier);
  }
  if (options?.access) {
    builder = builder.overrideProvider(PROPERTY_ACCESS).useValue(options.access);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app, options?.corsOrigins ? { corsOrigins: options.corsOrigins } : undefined);
  await app.init();
  return app;
}

function verifier(): AccessTokenVerifier {
  return {
    verify(token: string) {
      if (token === 'valid-owner') return { sub: 'user-owner' };
      if (token === 'valid-viewer') return { sub: 'user-viewer' };
      if (token === 'valid-other') return { sub: 'user-other' };
      if (token === 'expired') return 'expired';
      return 'invalid';
    },
  };
}

function access(): PropertyAccess {
  return {
    resolve({ userId, propertyId }) {
      if (userId === 'user-owner' && propertyId === UUID) return { role: 'owner', userId };
      if (userId === 'user-viewer' && propertyId === UUID) return { role: 'viewer', userId };
      return null;
    },
    documentBelongsToProperty(propertyId, documentId) {
      return propertyId === UUID && documentId === UUID_B;
    },
  };
}

async function send(
  server: Parameters<typeof request>[0],
  method: string,
  path: string,
  options?: { token?: string; body?: string; origin?: string; contentType?: string },
): Promise<request.Response> {
  const call = request(server)[method.toLowerCase() as 'get'](path);
  if (options?.token) call.set('Authorization', options.token);
  if (options?.origin) call.set('Origin', options.origin);
  if (options?.contentType) call.set('Content-Type', options.contentType);
  if (options?.body !== undefined) call.send(options.body);
  return call;
}

function rawExchange(
  port: number,
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolvePromise({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('API P1', () => {
  let app: INestApplication;
  let routes: string[] = [];

  beforeAll(async () => {
    app = await boot();
    routes = listRoutes(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('inventory matches docs/API.md, including GET /v1/health', () => {
    const markdown = readFileSync(resolve(repoRoot, 'docs/API.md'), 'utf8');
    const stated = Number(markdown.match(/maps \*\*(\d+)\*\* routes/)?.[1]);
    const documented = documentedRoutes(markdown);
    const registered = routes.map(canonical).sort();
    expect(registered).toEqual(documented);
    expect(registered).toHaveLength(stated);
    expect(new Set(routes.map((route) => familyOf(route.split(/\s+/)[1] ?? ''))).size).toBe(FAMILIES.length);
    expect(routes.some((route) => route.includes('crop-url'))).toBe(false);
    expect(routes.some((route) => /DELETE\s+\/v1\/properties\/:propertyId\/payments/.test(route))).toBe(false);
  });

  it('list stubs return { items: [], stub: true, module }', async () => {
    const server = app.getHttpServer();
    const lists = routes.filter(isListTemplate);
    expect(lists.map(canonical).sort()).toEqual(Object.keys(LIST_MODULES).sort());
    for (const route of lists) {
      const [method, path] = route.split(/\s+/) as [string, string];
      const response = await send(server, method, fill(path));
      expect(response.status, route).toBe(200);
      expect(response.body, route).toEqual({
        items: [],
        stub: true,
        module: LIST_MODULES[canonical(route)],
      });
      expectNoSecret(response.body);
    }
  });

  it('every non-OCR write and get-one returns 501 with no URL or storageKey', async () => {
    const server = app.getHttpServer();
    const targets = routes.filter((route) => {
      const path = route.split(/\s+/)[1] ?? '';
      if (isOcr(path) || path.startsWith('/v1/auth') || path === '/health' || path === '/v1/health' || isListTemplate(route)) {
        return false;
      }
      return true;
    });
    expect(targets.length).toBeGreaterThan(0);
    for (const route of targets) {
      const [method, path] = route.split(/\s+/) as [string, string];
      const response = await send(server, method, fill(path), { body: '{}', contentType: 'application/json' });
      expect(response.status, route).toBe(501);
      expect(response.body.module, route).toEqual(expect.any(String));
      expectNoSecret(response.body);
    }
  });

  it('pins AccessTokenGuard to the OCR routes and the live auth routes', () => {
    expect(routesUsing(app, AccessTokenGuard)).toEqual([...GUARDED_ROUTES].sort());
  });

  it('covers unhappy paths for every route family while the OCR flag is off', async () => {
    const server = app.getHttpServer();
    const seen = new Set<Family>();
    for (const route of routes) {
      const [method, template] = route.split(/\s+/) as [string, string];
      const family = familyOf(template);
      seen.add(family);
      const concrete = fill(template);
      const ocr = isOcr(template);
      if (family === 'auth') {
        for (const token of [undefined, 'Bearer nope', 'Bearer expired']) {
          const response = await send(server, method, concrete, {
            token,
            body: method === 'GET' ? undefined : '{}',
            contentType: method === 'GET' ? undefined : 'application/json',
          });
          expect(response.status, `${route} ${token ?? 'no token'}`).toBe(template === '/v1/auth/code' ? 400 : 401);
          expectNoSecret(response.body);
        }
        if (method !== 'GET') {
          const empty = await send(server, method, concrete, { body: '', contentType: 'application/json' });
          expect(empty.status, `${route} empty`).toBe(template === '/v1/auth/code' ? 400 : 401);
          const bearerFirst = template === '/v1/auth/logout';
          const targets = bearerFirst ? [concrete, '/v1/auth/logout/'] : [concrete];
          for (const path of targets) {
            const malformed = await send(server, method, path, { body: '{', contentType: 'application/json' });
            expect(malformed.status, `${path} malformed`).toBe(bearerFirst ? 401 : 400);
            const oversized = await send(server, method, path, {
              body: `{"pad":"${'x'.repeat(40_000)}"}`,
              contentType: 'application/json',
            });
            expect(oversized.status, `${path} oversized`).toBe(bearerFirst ? 401 : 413);
          }
        }
        continue;
      }

      for (const token of [undefined, 'Bearer nope', 'Bearer expired']) {
        const response = await send(server, method, concrete, {
          token,
          body: method === 'GET' ? undefined : '{}',
          contentType: method === 'GET' ? undefined : 'application/json',
        });
        const open =
          isListTemplate(route) || template === '/health'
            ? 200
            : template === '/v1/health'
              ? 503
              : 501;
        expect(response.status, `${family} ${route} ${token ?? 'no token'}`).toBe(open);
        expectNoSecret(response.body);
      }

      const cors = await send(server, method, concrete, { origin: 'https://evil.example' });
      expect(cors.headers['access-control-allow-origin'], family).toBeUndefined();

      if (!template.includes(':')) continue;

      for (const [label, spoiler] of [
        ['non-UUID', 'property-1'],
        ['malformed', 'not-a-uuid'],
        ['missing', 'missing'],
      ] as const) {
        const response = await send(server, method, spoilFirst(template, spoiler));
        expect(response.status, `${family} ${label} ${route}`).toBe(ocr ? 501 : 400);
        expectNoSecret(response.body);
      }

      for (const sample of TRAVERSAL) {
        const response = await send(server, method, spoilFirst(template, sample));
        expect(response.status, `${family} ${sample} ${route}`).toBe(ocr ? 501 : 400);
        expectNoSecret(response.body);
      }

      if (method === 'GET') continue;
      const empty = await send(server, method, concrete, { body: '', contentType: 'application/json' });
      expect(empty.status, `${family} empty ${route}`).toBe(501);
      expectNoSecret(empty.body);
      const malformed = await send(server, method, concrete, { body: '{', contentType: 'application/json' });
      expect(malformed.status, `${family} malformed json ${route}`).toBe(ocr ? 501 : 400);
      expectNoSecret(malformed.body);
      const oversized = await send(server, method, concrete, {
        body: `{"pad":"${'x'.repeat(40_000)}"}`,
        contentType: 'application/json',
      });
      expect(oversized.status, `${family} oversized ${route}`).toBe(ocr ? 501 : 413);
      expectNoSecret(oversized.body);
    }
    expect([...seen].sort()).toEqual([...FAMILIES].sort());
  });
});

describe('API P1 guarded OCR', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await boot({ enabled: true, verifier: verifier(), access: access() });
  });

  afterAll(async () => {
    await app.close();
  });

  it('AccessTokenGuard returns 401 for no, bad, and expired tokens on every route it guards', async () => {
    const server = app.getHttpServer();
    for (const route of GUARDED_ROUTES) {
      const [method, template] = route.split(/\s+/) as [string, string];
      const ids = [UUID, UUID_B, UUID];
      const path = template.replace(/:[A-Za-z0-9_]+/g, () => ids.shift() ?? UUID);
      for (const token of [undefined, 'Bearer nope', 'Bearer expired']) {
        const response = await send(server, method, path, {
          token,
          body: method === 'GET' ? undefined : '{}',
          contentType: method === 'GET' ? undefined : 'application/json',
        });
        expect(response.status, `${route} ${token ?? 'no token'}`).toBe(401);
        expectNoSecret(response.body);
      }
    }
  });

  it('TS-5.5 a viewer read is 200 and a viewer write is 403; another account stays 404', async () => {
    const server = app.getHttpServer();
    const created = await send(
      server,
      'POST',
      `/v1/properties/${UUID}/documents/${UUID_B}/ocr-jobs`,
      { token: 'Bearer valid-owner' },
    );
    expect(created.status).toBe(201);
    const jobId = created.body.id as string;
    const read = await send(server, 'GET', `/v1/properties/${UUID}/ocr-jobs/${jobId}`, {
      token: 'Bearer valid-viewer',
    });
    expect(read.status).toBe(200);
    const confirm = await send(server, 'POST', `/v1/properties/${UUID}/ocr-jobs/${jobId}/confirm`, {
      token: 'Bearer valid-viewer',
      body: '{"decisions":[]}',
      contentType: 'application/json',
    });
    expect(confirm.status).toBe(403);
    const enqueue = await send(server, 'POST', `/v1/properties/${UUID}/documents/${UUID_B}/ocr-jobs`, {
      token: 'Bearer valid-viewer',
    });
    expect(enqueue.status).toBe(403);
    const other = await send(server, 'GET', `/v1/properties/${UUID}/ocr-jobs/${jobId}`, {
      token: 'Bearer valid-other',
    });
    expect(other.status).toBe(404);
    expectNoSecret(confirm.body);
    expectNoSecret(other.body);
  });

  it('TS-5.5 leaves non-OCR writes at 501 because AccessTokenGuard is not attached there', async () => {
    const server = app.getHttpServer();
    const payment = await send(server, 'POST', `/v1/properties/${UUID}/payments`, {
      token: 'Bearer valid-viewer',
      body: '{}',
      contentType: 'application/json',
    });
    const voided = await send(server, 'POST', `/v1/properties/${UUID}/payments/${UUID}/void`, {
      token: 'Bearer valid-viewer',
      body: '{}',
      contentType: 'application/json',
    });
    const upload = await send(server, 'POST', `/v1/properties/${UUID}/evidence/upload-url`, {
      token: 'Bearer valid-viewer',
      body: '{}',
      contentType: 'application/json',
    });
    expect(payment.status).toBe(501);
    expect(voided.status).toBe(501);
    expect(upload.status).toBe(501);
    expectNoSecret(payment.body);
  });
});

describe('API P1 literal traversal and CORS allow-list', () => {
  let app: INestApplication;
  let port = 0;

  beforeAll(async () => {
    app = await boot({ corsOrigins: ['https://app.example'] });
    await app.listen(0);
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('HTTP server did not bind a port.');
    }
    port = address.port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 400 for a raw ../ id on every non-OCR family and 501 for OCR while the flag is off', async () => {
    const cases: Array<{ family: Family; path: string; status: number }> = [
      { family: 'properties', path: '/v1/properties/../payments', status: 400 },
      { family: 'memberships', path: '/v1/properties/../memberships', status: 400 },
      { family: 'invites', path: '/v1/properties/../invites', status: 400 },
      { family: 'obligations', path: '/v1/properties/../obligations', status: 400 },
      { family: 'payments', path: `/v1/properties/${UUID}/payments/../void`, status: 400 },
      { family: 'evidence', path: '/v1/properties/../evidence', status: 400 },
      { family: 'maintenance', path: '/v1/properties/../maintenance-tasks', status: 400 },
      { family: 'documents', path: '/v1/properties/../documents', status: 400 },
      { family: 'reminders', path: '/v1/properties/../reminders', status: 400 },
      { family: 'audit', path: '/v1/properties/../audit-events', status: 400 },
      { family: 'me', path: '/v1/me/../me', status: 400 },
      { family: 'home', path: '/v1/home/../home/action-items', status: 400 },
      { family: 'health', path: '/v1/health/../v1/health', status: 400 },
      { family: 'auth', path: '/v1/auth/../auth/code', status: 400 },
      {
        family: 'ocr',
        path: `/v1/properties/../documents/${UUID_B}/ocr-jobs`,
        status: 501,
      },
    ];
    expect(cases.map((item) => item.family).sort()).toEqual([...FAMILIES].sort());
    for (const item of cases) {
      const response = await rawExchange(port, 'GET', item.path);
      expect(response.status, item.family).toBe(item.status);
      expect(response.body).not.toMatch(/storage[_-]?key/i);
    }
  });

  it('does not reflect a non-allow-listed origin', async () => {
    const server = app.getHttpServer();
    const denied = await send(server, 'GET', '/v1/health', { origin: 'https://evil.example' });
    const allowed = await send(server, 'GET', '/v1/health', { origin: 'https://app.example' });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example');
    expect(allowed.headers['access-control-allow-origin']).not.toBe('*');
  });
});
