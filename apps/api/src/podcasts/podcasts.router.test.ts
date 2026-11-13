import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { TRPCError } from '@trpc/server';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../auth/auth.types.js';
import { fakeDb, type FakeResult, withFakeStorage } from '../testing/fake-db.js';
import { fakeJobs, testContext, unusedAiModels } from '../testing/fixtures.js';
import { appRouter } from '../trpc/app-router.js';
import type { TrpcContext } from '../trpc/context.js';
import { downloadFileName } from './podcasts.repository.js';
import { sampleOrdinals } from './topic-sampling.js';

const user: AuthUser = {
  id: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
  email: 'u@example.com',
  accessToken: 'token',
};
const notebookId = '7f4c1a52-2b8e-4a83-9d4e-0d6e5c3b2a10';
const podcastId = '5d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a';
const sourceA = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const sourceB = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

const ok = (data: unknown, count?: number): FakeResult => ({ data, error: null, count });

const row = {
  id: podcastId,
  notebook_id: notebookId,
  title: null,
  topic: 'Solar',
  mode: 'dialogue',
  target_minutes: 6,
  language: 'de',
  status: 'queued',
  error: null,
  duration_seconds: null,
  created_at: '2026-11-13T10:00:00+00:00',
  updated_at: '2026-11-13T10:00:00+00:00',
};

const summary = {
  id: podcastId,
  notebookId,
  title: null,
  topic: 'Solar',
  mode: 'dialogue',
  targetMinutes: 6,
  language: 'de',
  status: 'queued',
  error: null,
  durationSeconds: null,
  createdAt: '2026-11-13T10:00:00+00:00',
  updatedAt: '2026-11-13T10:00:00+00:00',
};

const readySources = ok([
  { id: sourceA, title: 'Report', status: 'ready' },
  { id: sourceB, title: 'Notes', status: 'ready' },
]);

function setup(results: FakeResult[], overrides: Partial<TrpcContext> = {}) {
  const { db, queries } = fakeDb(...results);
  const jobs = fakeJobs();
  const caller = appRouter.createCaller(testContext({ user, supabase: db, jobs, ...overrides }));
  return { caller, queries, jobs, db };
}

async function trpcError(promise: Promise<unknown>): Promise<TRPCError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TRPCError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

function jsonModel(value: unknown) {
  const result: LanguageModelV4GenerateResult = {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  };
  return new MockLanguageModelV4({ doGenerate: () => Promise.resolve(result) });
}

const createInput = {
  notebookId,
  sourceIds: [sourceA, sourceB],
  mode: 'dialogue' as const,
  targetMinutes: 6 as const,
  topic: ' Solar ',
};

describe('podcasts.create', () => {
  it('inserts the podcast and its sources, then enqueues the job', async () => {
    const { caller, queries, jobs } = setup([
      ok({ language: 'de' }),
      readySources,
      ok(null, 0),
      ok(null, 0),
      ok(row),
      ok(null),
    ]);
    await expect(caller.podcasts.create(createInput)).resolves.toEqual(summary);

    const insert = queries[4];
    expect(insert?.table).toBe('podcasts');
    const [method, [values]] = insert?.ops[0] ?? ['', []];
    expect(method).toBe('insert');
    expect(values).toMatchObject({
      notebook_id: notebookId,
      topic: 'Solar',
      mode: 'dialogue',
      target_minutes: 6,
    });
    expect(values).not.toHaveProperty('language');
    expect(values).not.toHaveProperty('status');
    const { id } = values as { id: string };

    expect(queries[5]?.table).toBe('podcast_sources');
    expect(queries[5]?.ops[0]).toEqual([
      'insert',
      [
        [
          { podcast_id: id, source_id: sourceA, notebook_id: notebookId },
          { podcast_id: id, source_id: sourceB, notebook_id: notebookId },
        ],
      ],
    ]);
    expect(jobs.sent).toEqual([
      { name: 'generate-podcast', data: { podcastId: id, notebookId, userId: user.id } },
    ]);
  });

  it('allows only one podcast in production per user', async () => {
    const { caller, queries, jobs } = setup([ok({ language: 'de' }), readySources, ok(null, 1)]);
    const error = await trpcError(caller.podcasts.create(createInput));
    expect(error.code).toBe('TOO_MANY_REQUESTS');
    expect(queries[2]?.ops).toContainEqual([
      'in',
      ['status', ['queued', 'scripting', 'synthesizing']],
    ]);
    expect(queries).toHaveLength(3);
    expect(jobs.sent).toHaveLength(0);
  });

  it('maps the unique index race to TOO_MANY_REQUESTS', async () => {
    const { caller } = setup([
      ok({ language: 'de' }),
      readySources,
      ok(null, 0),
      ok(null, 0),
      { data: null, error: { code: '23505', message: 'duplicate key' } },
    ]);
    expect((await trpcError(caller.podcasts.create(createInput))).code).toBe('TOO_MANY_REQUESTS');
  });

  it('enforces the daily limit', async () => {
    const { caller } = setup([ok({ language: 'de' }), readySources, ok(null, 0), ok(null, 10)]);
    const error = await trpcError(caller.podcasts.create(createInput));
    expect(error.code).toBe('TOO_MANY_REQUESTS');
    expect(error.message).toMatch(/10 podcasts per day/);
  });

  it('rejects sources that are missing or not ready', async () => {
    const missing = setup([
      ok({ language: 'de' }),
      ok([{ id: sourceA, title: 'R', status: 'ready' }]),
    ]);
    expect((await trpcError(missing.caller.podcasts.create(createInput))).code).toBe('NOT_FOUND');

    const pending = setup([
      ok({ language: 'de' }),
      ok([
        { id: sourceA, title: 'R', status: 'ready' },
        { id: sourceB, title: 'N', status: 'processing' },
      ]),
    ]);
    expect((await trpcError(pending.caller.podcasts.create(createInput))).code).toBe('BAD_REQUEST');
  });

  it('returns NOT_FOUND for a notebook the user cannot see', async () => {
    const { caller } = setup([ok(null)]);
    expect((await trpcError(caller.podcasts.create(createInput))).code).toBe('NOT_FOUND');
  });

  it('removes the podcast again when enqueueing fails', async () => {
    const { db, queries } = fakeDb(
      ok({ language: 'de' }),
      readySources,
      ok(null, 0),
      ok(null, 0),
      ok(row),
      ok(null),
      ok(null),
    );
    const caller = appRouter.createCaller(
      testContext({
        user,
        supabase: db,
        jobs: { send: () => Promise.reject(new Error('queue down')) },
      }),
    );
    await expect(caller.podcasts.create(createInput)).rejects.toThrow(/queue down/);
    expect(queries[6]?.table).toBe('podcasts');
    expect(queries[6]?.ops[0]).toEqual(['delete', []]);
  });

  it('validates input before touching the database', async () => {
    const { caller, queries } = setup([]);
    expect((await trpcError(caller.podcasts.create({ ...createInput, topic: '   ' }))).code).toBe(
      'BAD_REQUEST',
    );
    expect(
      // @ts-expect-error unsupported length
      (await trpcError(caller.podcasts.create({ ...createInput, targetMinutes: 10 }))).code,
    ).toBe('BAD_REQUEST');
    expect(queries).toHaveLength(0);
  });
});

describe('podcasts.list / get', () => {
  it('lists podcasts of a notebook, newest first', async () => {
    const { caller, queries } = setup([ok([row])]);
    await expect(caller.podcasts.list({ notebookId })).resolves.toEqual([summary]);
    expect(queries[0]?.ops).toContainEqual(['eq', ['notebook_id', notebookId]]);
    expect(queries[0]?.ops).toContainEqual(['order', ['created_at', { ascending: false }]]);
  });

  it('returns script, sources and signed URLs for a ready podcast', async () => {
    const script = { title: 'Solar boom', segments: [{ speaker: 'A', text: 'Hallo.' }] };
    const base = setup([
      ok({
        ...row,
        status: 'ready',
        title: 'Solar boom',
        duration_seconds: 361.5,
        script,
        storage_path: `${user.id}/${notebookId}/${podcastId}/podcast.mp3`,
      }),
      ok([{ source_id: sourceA }]),
      ok([{ id: sourceA, title: 'Report' }]),
    ]);
    const { calls } = withFakeStorage(
      base.db,
      ok({ signedUrl: 'https://storage.example/play?token=1' }),
      ok({ signedUrl: 'https://storage.example/dl?token=2' }),
    );
    const detail = await base.caller.podcasts.get({ id: podcastId });
    expect(detail).toMatchObject({
      status: 'ready',
      durationSeconds: 361.5,
      script,
      sources: [{ id: sourceA, title: 'Report' }],
      audioUrl: 'https://storage.example/play?token=1',
      downloadUrl: 'https://storage.example/dl?token=2',
    });
    expect(calls.map((call) => [call.bucket, call.method])).toEqual([
      ['podcasts', 'createSignedUrl'],
      ['podcasts', 'createSignedUrl'],
    ]);
    expect(calls[1]?.args[2]).toEqual({ download: 'Solar boom.mp3' });
  });

  it('has no audio URLs while the podcast is in production', async () => {
    const { caller } = setup([ok({ ...row, script: null, storage_path: null }), ok([])]);
    await expect(caller.podcasts.get({ id: podcastId })).resolves.toMatchObject({
      script: null,
      sources: [],
      audioUrl: null,
      downloadUrl: null,
    });
  });

  it('returns NOT_FOUND for podcasts of other users', async () => {
    const { caller } = setup([ok(null)]);
    expect((await trpcError(caller.podcasts.get({ id: podcastId }))).code).toBe('NOT_FOUND');
  });
});

describe('podcasts.delete', () => {
  it('removes the audio folder, then the row', async () => {
    const base = setup([
      ok({ id: podcastId, user_id: user.id, notebook_id: notebookId }),
      ok({ id: podcastId }),
    ]);
    const { calls } = withFakeStorage(
      base.db,
      ok([{ name: 'batch-0.mp3' }, { name: 'podcast.mp3' }]),
      ok([]),
    );
    await expect(base.caller.podcasts.delete({ id: podcastId })).resolves.toEqual({
      id: podcastId,
    });
    const folder = `${user.id}/${notebookId}/${podcastId}`;
    expect(calls[0]).toMatchObject({ method: 'list', args: [folder, { limit: 1000 }] });
    expect(calls[1]).toMatchObject({
      method: 'remove',
      args: [[`${folder}/batch-0.mp3`, `${folder}/podcast.mp3`]],
    });
    expect(base.queries[1]?.ops[0]).toEqual(['delete', []]);
  });

  it('keeps the row when Storage fails', async () => {
    const base = setup([ok({ id: podcastId, user_id: user.id, notebook_id: notebookId })]);
    withFakeStorage(base.db, { data: null, error: { code: '500', message: 'storage down' } });
    expect((await trpcError(base.caller.podcasts.delete({ id: podcastId }))).code).toBe(
      'INTERNAL_SERVER_ERROR',
    );
    expect(base.queries).toHaveLength(1);
  });
});

describe('podcasts.suggestTopics', () => {
  const topics = [
    { title: 'Solarboom', angle: 'Warum sich die Kapazität verdoppelt hat.' },
    { title: 'Speicher', angle: 'Was billigere Speicher ändern.' },
    { title: 'Netze', angle: 'Wo die Engpässe liegen.' },
  ];

  it('samples chunks and suggests topics in the notebook language', async () => {
    const model = jsonModel({ topics });
    const { caller, queries } = setup(
      [
        ok({ language: 'de' }),
        readySources,
        ok({ ordinal: 0 }),
        ok({ ordinal: 9 }),
        ok([{ source_id: sourceA, ordinal: 0, content: 'Solar verdoppelt.', token_count: 5 }]),
        ok([{ source_id: sourceB, ordinal: 0, content: 'Speicher billiger.', token_count: 5 }]),
      ],
      { ai: { ...unusedAiModels, chat: model } },
    );
    await expect(
      caller.podcasts.suggestTopics({ notebookId, sourceIds: [sourceA, sourceB] }),
    ).resolves.toEqual({ topics });

    // source B has 10 chunks: 8 sampled, the first two plus an even spread
    expect(queries[5]?.ops).toContainEqual(['in', ['ordinal', sampleOrdinals(10, 8)]]);
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain('German (Deutsch)');
    expect(prompt).toContain('Solar verdoppelt.');
    expect(prompt).toContain('source=\\"Notes\\"');
  });

  it('is rate limited per user', async () => {
    const { db } = fakeDb(ok({ language: 'de' }), readySources);
    const caller = appRouter.createCaller(
      testContext({
        user,
        supabase: db,
        limits: { podcastSuggestionsPerHour: 0, podcastsPerDay: 10 },
      }),
    );
    expect(
      (
        await trpcError(
          caller.podcasts.suggestTopics({ notebookId, sourceIds: [sourceA, sourceB] }),
        )
      ).code,
    ).toBe('TOO_MANY_REQUESTS');
  });

  it('fails clearly when the sources have no chunks', async () => {
    const { caller } = setup([ok({ language: 'en' }), readySources, ok(null), ok(null)]);
    const error = await trpcError(
      caller.podcasts.suggestTopics({ notebookId, sourceIds: [sourceA, sourceB] }),
    );
    expect(error.code).toBe('BAD_REQUEST');
  });
});

describe('helpers', () => {
  it('samples leading chunks plus an even spread', () => {
    expect(sampleOrdinals(3, 8)).toEqual([0, 1, 2]);
    expect(sampleOrdinals(10, 4)).toEqual([0, 1, 4, 8]);
    expect(sampleOrdinals(100, 1)).toEqual([0]);
    expect(sampleOrdinals(0, 4)).toEqual([]);
  });

  it('builds safe download file names', () => {
    expect(downloadFileName('Solar: boom / 2026?')).toBe('Solar boom 2026.mp3');
    expect(downloadFileName('???')).toBe('podcast.mp3');
    expect(downloadFileName('Überblick')).toBe('Überblick.mp3');
  });

  it('requires a session', async () => {
    const caller = appRouter.createCaller(testContext());
    expect((await trpcError(caller.podcasts.list({ notebookId }))).code).toBe('UNAUTHORIZED');
  });
});
