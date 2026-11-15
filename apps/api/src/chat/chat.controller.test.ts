import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { type AiModels, EMBEDDING_DIMENSIONS } from '@notebook-lite/ai';
import { simulateReadableStream } from 'ai';
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_MODELS } from '../ai/ai-models.provider.js';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { JWKS } from '../auth/jwks.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { fakeDb, type FakeResult, type RecordedQuery } from '../testing/fake-db.js';
import { createTestKeys, type TestKeys, testEnv } from '../testing/fixtures.js';
import type { Db } from '../supabase/types.js';
import { CHAT_RATE_LIMITER } from './chat.controller.js';
import { finalizeAnswer } from './chat-stream.service.js';
import { UserRateLimiter } from './user-rate-limiter.js';

const chatId = '3c2b1a09-8f7e-4d6c-9b5a-4c3d2e1f0a9b';
const notebookId = '7f4c1a52-2b8e-4a83-9d4e-0d6e5c3b2a10';
const sourceA = '0b0c6d1e-3f4a-4b5c-8d6e-7f8091a2b3c4';
const sourceB = '1c1d7e2f-4a5b-4c6d-9e7f-8091a2b3c4d5';
const chunk1 = '5e4d3c2b-1a09-4f8e-8d7c-6b5a49382716';
const chunk2 = '6f5e4d3c-2b1a-4098-9e8d-7c6b5a493827';

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

const ok = (data: unknown): FakeResult => ({ data, error: null });

function chatRow(overrides: Record<string, unknown> = {}) {
  return {
    id: chatId,
    notebook_id: notebookId,
    title: null,
    notebooks: { language: 'de' },
    chat_sources: [
      { source_id: sourceA, sources: { title: 'Paper', status: 'ready' } },
      { source_id: sourceB, sources: { title: 'Draft', status: 'processing' } },
    ],
    ...overrides,
  };
}

function matchRow(id: string, sourceId: string, content: string, page: number | null) {
  return {
    id,
    source_id: sourceId,
    ordinal: 0,
    content,
    page_start: page,
    page_end: page,
    heading_path: [],
    char_start: 0,
    char_end: content.length,
    token_count: 10,
    score: 0.03,
    semantic_rank: 1,
    keyword_rank: 1,
  };
}

/** Chat model mock: streams `answer` deltas; generateText calls return `generated` in order. */
function mockModels(answer: string[], generated: string[]) {
  let generateCall = 0;
  const chat = new MockLanguageModelV4({
    modelId: 'mock-chat',
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 't' },
            ...answer.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
            { type: 'text-end', id: 't' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
          ],
        }),
      }),
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: 'text', text: generated[generateCall++] ?? '' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      }),
  });
  const embedding = new MockEmbeddingModelV4({
    maxEmbeddingsPerCall: 2048,
    doEmbed: ({ values }) =>
      Promise.resolve({
        embeddings: values.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.5)),
        usage: { tokens: 1 },
        warnings: [],
      }),
  });
  return { chat, embedding };
}

/** Parses the SSE body into UI-message chunks. */
function parseSse(body: string): { type: string; [key: string]: unknown }[] {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice('data: '.length)) as { type: string });
}

describe('POST /chat/:chatId/stream', () => {
  let app: NestExpressApplication;
  let keys: TestKeys;
  let token: string;
  let db: Db;
  let queries: RecordedQuery[];
  const models: { current: AiModels } = { current: mockModels([], []) };
  const limiter = { current: new UserRateLimiter(100) };

  function useDb(...results: FakeResult[]) {
    ({ db, queries } = fakeDb(...results));
  }

  beforeAll(async () => {
    keys = await createTestKeys();
    token = await keys.sign({ sub: 'user-1' });
    const env = { ...testEnv, LOG_LEVEL: 'error' as const };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
      .overrideProvider(JWKS)
      .useValue(keys.jwks)
      .overrideProvider(SupabaseService)
      .useValue({ forUser: () => db })
      .overrideProvider(AI_MODELS)
      .useValue(
        new Proxy({} as AiModels, { get: (_target, prop: keyof AiModels) => models.current[prop] }),
      )
      .overrideProvider(CHAT_RATE_LIMITER)
      .useValue({ take: (key: string) => limiter.current.take(key) })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, env);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    limiter.current = new UserRateLimiter(100);
    useDb();
  });

  const post = (body: unknown, id = chatId) =>
    request(app.getHttpServer())
      .post(`/chat/${id}/stream`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  it('requires a session', async () => {
    const res = await request(app.getHttpServer())
      .post(`/chat/${chatId}/stream`)
      .send({ text: 'x' });
    expect(res.status).toBe(401);
  });

  it('validates the chat id and the message', async () => {
    await post({ text: 'Hi' }, 'not-a-uuid').expect(400);
    await post({ text: '   ' }).expect(400);
    await post({}).expect(400);
    expect(queries).toHaveLength(0);
  });

  it('returns 404 for a chat the user cannot see', async () => {
    useDb(ok(null));
    expect((await post({ text: 'Hi' })).status).toBe(404);
  });

  it('returns 400 with a hint when no ready source is selected', async () => {
    useDb(
      ok(
        chatRow({
          chat_sources: [{ source_id: sourceB, sources: { title: 'D', status: 'pending' } }],
        }),
      ),
    );
    const res = await post({ text: 'Hi' }).expect(400);
    expect(res.body).toEqual({
      error: { code: 'NO_SOURCES_SELECTED', message: 'None of the selected sources is ready yet.' },
    });
    expect(queries).toHaveLength(1);

    useDb(ok(chatRow({ chat_sources: [] })));
    const empty = await post({ text: 'Hi' }).expect(400);
    expect(empty.body.error.message).toMatch(/Select at least one source/);
  });

  it('streams a grounded answer with citations first and persists both messages', async () => {
    models.current = mockModels(
      ['Wasser siedet bei 100 °C [1]. ', 'Eis schmilzt bei 0 °C [3].'],
      ['Siedepunkt von Wasser'],
    );
    useDb(
      ok(chatRow()),
      ok([]), // history
      ok(null), // insert question
      ok([
        matchRow(chunk1, sourceA, 'Water boils at 100 °C.', 3),
        matchRow(chunk2, sourceA, 'Ice melts at 0 °C.', null),
      ]),
      ok(null), // insert answer
      ok(null), // update title
    );

    const res = await post({ text: '  Wann siedet Wasser? ' })
      .expect(200)
      .expect('content-type', /text\/event-stream/);
    const parts = parseSse(res.text);
    const types = parts.map((part) => part.type);

    expect(types[0]).toBe('start');
    expect(types[1]).toBe('data-citations');
    expect(types.indexOf('data-citations')).toBeLessThan(types.indexOf('text-delta'));
    expect(types.slice(-2)).toEqual(['data-chat-title', 'finish']);

    const citations = [
      {
        marker: 1,
        chunkId: chunk1,
        sourceId: sourceA,
        sourceTitle: 'Paper',
        page: 3,
        quote: 'Water boils at 100 °C.',
      },
      {
        marker: 2,
        chunkId: chunk2,
        sourceId: sourceA,
        sourceTitle: 'Paper',
        page: null,
        quote: 'Ice melts at 0 °C.',
      },
    ];
    expect(parts[1]).toMatchObject({ data: citations });
    expect(parts.at(-2)).toMatchObject({
      data: { title: 'Siedepunkt von Wasser' },
      transient: true,
    });

    // chats, history, question, match_chunks, answer, title
    expect(queries.map((query) => query.table)).toEqual([
      'chats',
      'messages',
      'messages',
      'rpc:match_chunks',
      'messages',
      'chats',
    ]);
    expect(queries[2]?.ops[0]).toEqual([
      'insert',
      [{ chat_id: chatId, role: 'user', content: 'Wann siedet Wasser?' }],
    ]);
    const rpcArgs = queries[3]?.ops[0]?.[1][0] as Record<string, unknown>;
    expect(rpcArgs).toMatchObject({
      p_notebook_id: notebookId,
      p_query_text: 'Wann siedet Wasser?',
      p_source_ids: [sourceA],
      p_match_count: 12,
    });
    expect(String(rpcArgs.p_query_embedding)).toMatch(/^\[0\.5,0\.5,/);

    // Unknown marker [3] dropped; only the used citation is snapshotted.
    expect(queries[4]?.ops[0]).toEqual([
      'insert',
      [
        {
          chat_id: chatId,
          role: 'assistant',
          content: 'Wasser siedet bei 100 °C [1]. Eis schmilzt bei 0 °C.',
          citations: [citations[0]],
          model: 'mock-chat',
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        },
      ],
    ]);
    expect(queries[5]?.ops[0]).toEqual(['update', [{ title: 'Siedepunkt von Wasser' }]]);

    // No query rewrite for the first question: one generate call (the title), in German.
    const chatModel = models.current.chat as MockLanguageModelV4;
    expect(chatModel.doGenerateCalls).toHaveLength(1);
    expect(JSON.stringify(chatModel.doGenerateCalls[0]?.prompt)).toContain('German (de)');
    expect(JSON.stringify(chatModel.doStreamCalls[0]?.prompt)).toContain('German (de)');
  });

  it('rewrites follow-ups and keeps an existing title', async () => {
    models.current = mockModels(['Antwort [1].'], ['Gefrierpunkt von Wasser']);
    useDb(
      ok(chatRow({ title: 'Wasser' })),
      ok([
        { role: 'assistant', content: 'Wasser siedet bei 100 °C [1].' },
        { role: 'user', content: 'Wann siedet Wasser?' },
      ]),
      ok(null),
      ok([matchRow(chunk2, sourceA, 'Ice melts at 0 °C.', null)]),
      ok(null),
      ok(null),
    );

    const parts = parseSse((await post({ text: 'Und wann gefriert es?' }).expect(200)).text);
    expect(parts.some((part) => part.type === 'data-chat-title')).toBe(false);

    const chatModel = models.current.chat as MockLanguageModelV4;
    expect(chatModel.doGenerateCalls).toHaveLength(1);
    const rewritePrompt = JSON.stringify(chatModel.doGenerateCalls[0]?.prompt);
    expect(rewritePrompt).toContain('Und wann gefriert es?');
    expect(rewritePrompt).toContain('User: Wann siedet Wasser?');
    expect(queries[3]?.ops[0]?.[1][0]).toMatchObject({ p_query_text: 'Gefrierpunkt von Wasser' });
    // History reaches the answer model oldest first, markers stripped.
    const answerPrompt = JSON.stringify(chatModel.doStreamCalls[0]?.prompt);
    expect(answerPrompt.indexOf('Wann siedet Wasser?')).toBeLessThan(
      answerPrompt.indexOf('Wasser siedet bei 100 °C.'),
    );
    // Touch the chat (same title) so it moves up in the list.
    expect(queries[5]?.ops[0]).toEqual(['update', [{ title: 'Wasser' }]]);
  });

  it('sends an error part and persists no answer when retrieval fails', async () => {
    models.current = mockModels(['unused'], []);
    useDb(ok(chatRow()), ok([]), ok(null), {
      data: null,
      error: { code: 'XX000', message: 'boom' },
    });
    const parts = parseSse((await post({ text: 'Hi' }).expect(200)).text);
    expect(parts.at(-1)).toEqual({
      type: 'error',
      errorText: 'The answer could not be generated. Please try again.',
    });
    expect(queries).toHaveLength(4);
  });

  it('limits messages per user', async () => {
    limiter.current = new UserRateLimiter(1);
    useDb(ok(chatRow({ chat_sources: [] })));
    await post({ text: 'Hi' }).expect(400);
    const res = await post({ text: 'Hi' }).expect(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});

const citation = (marker: number) => ({
  marker,
  chunkId: chunk1,
  sourceId: sourceA,
  sourceTitle: 'P',
  page: null,
  quote: 'q',
});

describe('finalizeAnswer', () => {
  it('keeps only valid, used markers and counts uncited sentences', () => {
    const result = finalizeAnswer(
      'The first claim is supported [2][7]. The second claim has no support at all. ',
      [citation(1), citation(2)],
    );
    expect(result.content).toBe(
      'The first claim is supported [2]. The second claim has no support at all.',
    );
    expect(result.citations.map((c) => c.marker)).toEqual([2]);
    expect(result.uncitedSentences).toBe(1);
  });
});
