import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { AiModels } from '@notebook-lite/ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AI_MODELS } from '../ai/ai-models.provider.js';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { JWKS } from '../auth/jwks.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { fakeDb, type FakeResult } from '../testing/fake-db.js';
import { createTestKeys, testEnv, unusedAiModels } from '../testing/fixtures.js';

const notebookId = '7f4c1a52-2b8e-4a83-9d4e-0d6e5c3b2a10';
const sourceId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ok = (data: unknown): FakeResult => ({ data, error: null });

const topics = [
  { title: 'Solarboom', angle: 'Warum sich die Kapazität verdoppelt hat.' },
  { title: 'Speicher', angle: 'Was billigere Speicher ändern.' },
  { title: 'Netze', angle: 'Wo die Engpässe liegen.' },
];

/**
 * A model that streams the first topic, then holds the rest of its answer until `release()`,
 * so the test can observe whether the first topic reaches the client before the model is done.
 */
function heldModel() {
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  const json = JSON.stringify({ elements: topics });
  const split = json.indexOf('{"title":"Speicher"') + 5;
  const model = new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          async start(controller) {
            controller.enqueue({ type: 'text-start', id: 't' });
            controller.enqueue({ type: 'text-delta', id: 't', delta: json.slice(0, split) });
            await held;
            controller.enqueue({ type: 'text-delta', id: 't', delta: json.slice(split) });
            controller.enqueue({ type: 'text-end', id: 't' });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            });
            controller.close();
          },
        }),
      }),
  });
  return { model, release };
}

describe('podcasts.suggestTopics over HTTP', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let token: string;
  const models: { current: AiModels } = { current: unusedAiModels };
  const db: { current: ReturnType<typeof fakeDb>['db'] } = { current: fakeDb().db };

  beforeAll(async () => {
    const keys = await createTestKeys();
    token = await keys.sign({ sub: 'user-1' });
    const env = { ...testEnv, LOG_LEVEL: 'error' as const };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
      .overrideProvider(JWKS)
      .useValue(keys.jwks)
      .overrideProvider(SupabaseService)
      .useValue({ forUser: () => db.current })
      .overrideProvider(AI_MODELS)
      .useValue(
        new Proxy({} as AiModels, { get: (_target, prop: keyof AiModels) => models.current[prop] }),
      )
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, env);
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('streams the first topic before the model has finished (httpBatchStreamLink protocol)', async () => {
    const { model, release } = heldModel();
    models.current = { ...unusedAiModels, chat: model };
    db.current = fakeDb(
      ok({ language: 'de' }),
      ok([{ id: sourceId, title: 'Report', status: 'ready' }]),
      ok({ ordinal: 0 }),
      ok([{ source_id: sourceId, ordinal: 0, content: 'Solar verdoppelt.', token_count: 5 }]),
    ).db;

    // What `httpBatchStreamLink` sends: a batched POST that accepts JSON lines.
    const res = await fetch(`${baseUrl}/trpc/podcasts.suggestTopics?batch=1`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'trpc-accept': 'application/jsonl',
      },
      body: JSON.stringify({ 0: { notebookId, sourceIds: [sourceId] } }),
    });
    expect(res.status).toBe(200);

    const decoder = new TextDecoder();
    let received = '';
    let firstTopicEarly = false;
    for await (const chunk of res.body!) {
      received += decoder.decode(chunk, { stream: true });
      if (!firstTopicEarly && received.includes('Solarboom')) {
        // The model is still holding topics 2 and 3 back; only now let it finish.
        firstTopicEarly = !received.includes('Speicher');
        release();
      }
    }
    expect(firstTopicEarly).toBe(true);
    expect(received).toContain('Speicher');
    expect(received).toContain('Netze');
  });
});
