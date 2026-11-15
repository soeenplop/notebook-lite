import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { testEnv } from './testing/fixtures.js';

describe('HTTP hardening', () => {
  let app: NestExpressApplication;
  const env = { ...testEnv, LOG_LEVEL: 'error' as const, RATE_LIMIT_PER_MINUTE: 3 };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, env);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a request id, reusing a valid incoming one', async () => {
    const generated = await request(app.getHttpServer()).get('/healthz');
    expect(generated.headers['x-request-id']).toMatch(/^[\w-]{8,}$/);

    const reused = await request(app.getHttpServer())
      .get('/healthz')
      .set('X-Request-Id', 'trace-abc_123');
    expect(reused.headers['x-request-id']).toBe('trace-abc_123');

    const rejected = await request(app.getHttpServer())
      .get('/healthz')
      .set('X-Request-Id', 'bad id with spaces');
    expect(rejected.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('rate-limits per client IP but never the health check', async () => {
    const server = app.getHttpServer();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      // Sequential on purpose: the limiter counts requests in order.
      // oxlint-disable-next-line no-await-in-loop
      statuses.push((await request(server).get('/trpc/auth.me')).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    await request(server).get('/healthz').expect(200);
  });
});
