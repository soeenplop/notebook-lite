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
  work: vi.fn<(name: string, handler: unknown) => Promise<string>>(() =>
    Promise.resolve('worker-id'),
  ),
};

describe('GET /healthz', () => {
  let app: INestApplication;
  let startCallsOnInit = 0;
  let queuesWorkedOnInit: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        WorkerModule.forRoot({
          WORKER_PORT: 0,
          LOG_LEVEL: 'info',
          DATABASE_URL: 'postgres://test',
          SUPABASE_URL: 'https://test-project.supabase.co',
          SUPABASE_SECRET_KEY: 'sb_secret_test',
          OPENAI_API_KEY: 'sk-test',
          OPENAI_CHAT_MODEL: 'gpt-test',
          OPENAI_EMBEDDING_MODEL: 'embedding-test',
        }),
      ],
    })
      .overrideProvider(JobQueue)
      .useValue(fakeQueue)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    startCallsOnInit = fakeQueue.start.mock.calls.length;
    queuesWorkedOnInit = fakeQueue.work.mock.calls.map(([name]) => name);
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

  it('registers the ingest-source consumer', () => {
    expect(queuesWorkedOnInit).toEqual(['ingest-source']);
  });
});
