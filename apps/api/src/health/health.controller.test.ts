import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { healthResponseSchema } from '@notebook-lite/shared';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { testEnv } from '../testing/fixtures.js';

describe('GET /healthz', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(testEnv)],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body.service).toBe('api');
  });
});
