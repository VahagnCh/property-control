import { ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PrismaErrorFilter } from './prisma-error.filter.js';

describe('Prisma error filter', () => {
  it('answers a unique conflict without the row text', () => {
    const body = capture(
      new Prisma.PrismaClientKnownRequestError('new row contains secret-note and Captura duplicada', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    expect(body.status).toBe(409);
    expect(body.json).toMatchObject({ error: 'idempotency_key_reused' });
    expect(JSON.stringify(body.json)).not.toContain('secret-note');
    expect(JSON.stringify(body.json)).not.toContain('Captura');
  });

  it('hides other constraint failures', () => {
    const body = capture(
      new Prisma.PrismaClientKnownRequestError('Failing row contains (secret-note)', {
        code: 'P2003',
        clientVersion: 'test',
      }),
    );
    expect(body.status).toBe(500);
    expect(body.json).toEqual({
      statusCode: 500,
      error: 'persistence_failed',
      message: 'The request could not be stored.',
    });
  });
});

function capture(error: Prisma.PrismaClientKnownRequestError): { status: number; json: unknown } {
  let status = 0;
  let json: unknown;
  const response = {
    headersSent: false,
    status(code: number) {
      status = code;
      return this;
    },
    json(value: unknown) {
      json = value;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  new PrismaErrorFilter().catch(error, host);
  return { status, json };
}
