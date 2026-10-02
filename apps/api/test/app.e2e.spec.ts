import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';

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
