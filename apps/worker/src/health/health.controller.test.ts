import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { healthResponseSchema } from '@notebook-lite/shared';
import request from 'supertest';
import { JobQueue } from '@notebook-lite/queue';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WorkerModule } from '../worker.module.js';

const fakeQueue = {
  start: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  stop: vi.fn<() => Promise<void>>(() => Promise.resolve()),
};

describe('GET /healthz', () => {
  let app: INestApplication;
  let startCallsOnInit = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        WorkerModule.forRoot({
          WORKER_PORT: 0,
          LOG_LEVEL: 'info',
          DATABASE_URL: 'postgres://test',
        }),
      ],
    })
      .overrideProvider(JobQueue)
      .useValue(fakeQueue)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    startCallsOnInit = fakeQueue.start.mock.calls.length;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(healthResponseSchema.parse(res.body).service).toBe('worker');
  });

  it('connects the job queue on startup', () => {
    expect(startCallsOnInit).toBe(1);
  });
});
