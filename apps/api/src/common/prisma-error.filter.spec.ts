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
        meta: { target: ['property_id', 'recorded_by_user_id', 'idempotency_key'] },
      }),
    );
    expect(body.status).toBe(409);
    expect(body.json).toMatchObject({ error: 'idempotency_key_reused' });
    expect(JSON.stringify(body.json)).not.toContain('secret-note');
    expect(JSON.stringify(body.json)).not.toContain('Captura');
  });

  it('maps a non-idempotency unique clash to conflict', () => {
    const body = capture(
      new Prisma.PrismaClientKnownRequestError('new row contains secret-note', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['property_id', 'user_id'] },
      }),
    );
    expect(body.status).toBe(409);
    expect(body.json).toEqual({
      statusCode: 409,
      error: 'conflict',
      message: 'The request conflicts with an existing record.',
    });
    expect(JSON.stringify(body.json)).not.toContain('secret-note');
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
