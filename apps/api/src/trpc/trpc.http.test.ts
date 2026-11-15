import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { JWKS } from '../auth/jwks.js';
import { createTestKeys, type TestKeys, testEnv } from '../testing/fixtures.js';

describe('tRPC over HTTP', () => {
  let app: NestExpressApplication;
  let keys: TestKeys;

  beforeAll(async () => {
    keys = await createTestKeys();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(testEnv)] })
      .overrideProvider(JWKS)
      .useValue(keys.jwks)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, testEnv);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('auth.me returns the signed-in user', async () => {
    const token = await keys.sign({ sub: 'u-42', email: 'me@example.com' });
    const res = await request(app.getHttpServer())
      .get('/trpc/auth.me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({ result: { data: { id: 'u-42', email: 'me@example.com' } } });
  });

  it('auth.me requires a session', async () => {
    const res = await request(app.getHttpServer()).get('/trpc/auth.me').expect(401);
    expect(res.body.error.data.code).toBe('UNAUTHORIZED');
    expect(res.body.error.data.stack).toBeUndefined();
  });

  it('rejects an invalid token', async () => {
    const other = await createTestKeys();
    const res = await request(app.getHttpServer())
      .get('/trpc/auth.me')
      .set('Authorization', `Bearer ${await other.sign()}`);
    expect(res.status).toBe(401);
  });

  it('allows the configured CORS origin', async () => {
    const res = await request(app.getHttpServer())
      .options('/trpc/auth.me')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });
});
