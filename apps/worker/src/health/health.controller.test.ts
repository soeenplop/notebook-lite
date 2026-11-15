import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { healthResponseSchema } from '@notebook-lite/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkerModule } from '../worker.module.js';

describe('GET /healthz', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.forRoot({ WORKER_PORT: 0, LOG_LEVEL: 'info' })],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(healthResponseSchema.parse(res.body).service).toBe('worker');
  });
});
