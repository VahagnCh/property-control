import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { enforceHttps, HSTS_HEADER } from './https-only.js';

function run(protocol: string): { status?: number; body?: unknown; headers: Record<string, string>; next: boolean } {
  const headers: Record<string, string> = {};
  let status: number | undefined;
  let body: unknown;
  let next = false;
  const req = { protocol } as Request;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as Response;
  const done: NextFunction = () => {
    next = true;
  };
  enforceHttps(req, res, done);
  return { status, body, headers, next };
}

describe('enforceHttps', () => {
  const previous = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = previous;
  });

  it('does nothing outside production', () => {
    process.env.NODE_ENV = 'test';
    const result = run('http');
    expect(result.next).toBe(true);
    expect(result.status).toBeUndefined();
    expect(result.headers).toEqual({});
  });

  it('rejects plain HTTP in production and does not send HSTS', () => {
    process.env.NODE_ENV = 'production';
    const result = run('http');
    expect(result.next).toBe(false);
    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      statusCode: 403,
      error: 'https_required',
      message: 'HTTPS is required.',
    });
    expect(result.headers['Strict-Transport-Security']).toBeUndefined();
  });

  it('sets HSTS on HTTPS in production', () => {
    process.env.NODE_ENV = 'production';
    const result = run('https');
    expect(result.next).toBe(true);
    expect(result.headers['Strict-Transport-Security']).toBe(HSTS_HEADER);
  });
});
