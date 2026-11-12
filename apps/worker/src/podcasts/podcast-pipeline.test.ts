import { readFile, writeFile } from 'node:fs/promises';
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { EMBEDDING_DIMENSIONS } from '@notebook-lite/ai';
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { fakeServiceDb, type FakeState } from '../testing/fake-service-db.js';
import type { AudioTools } from './audio.js';
import {
  type DialogueRequest,
  type DialogueSynthesizer,
  ElevenLabsError,
} from './elevenlabs.client.js';
import { MESSAGES, PodcastPipeline, type PodcastPipelineDeps } from './podcast-pipeline.js';

const userId = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const otherUser = '0f1e2d3c-4b5a-4968-8776-655443322110';
const notebookId = '7f4c1a52-2b8e-4a83-9d4e-0d6e5c3b2a10';
const podcastId = '5d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a';
const sourceA = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const job = { podcastId, notebookId, userId };
const folder = `${userId}/${notebookId}/${podcastId}`;

const script = {
  title: 'Solarboom',
  segments: [
    { speaker: 'A', text: 'a'.repeat(900) },
    { speaker: 'B', text: 'b'.repeat(900) },
    { speaker: 'A', text: 'c'.repeat(900) },
  ],
};

function podcastRow(overrides: Record<string, unknown> = {}) {
  return {
    id: podcastId,
    user_id: userId,
    notebook_id: notebookId,
    language: 'de',
    topic: 'Solarenergie',
    mode: 'dialogue',
    target_minutes: 6,
    status: 'queued',
    script: null,
    title: null,
    error: null,
    storage_path: null,
    duration_seconds: null,
    ...overrides,
  };
}

function initialState(podcast: Record<string, unknown> | null = podcastRow()): Partial<FakeState> {
  return {
    tables: {
      podcasts: podcast ? [podcast] : [],
      notebooks: [{ id: notebookId, user_id: userId }],
      podcast_sources: [{ podcast_id: podcastId, source_id: sourceA, user_id: userId }],
      sources: [
        { id: sourceA, user_id: userId, notebook_id: notebookId, status: 'ready', title: 'Report' },
      ],
    },
    matchChunks: [
      {
        id: 'c2',
        source_id: sourceA,
        ordinal: 2,
        content: 'Speicher wurden billiger.',
        token_count: 6,
      },
      {
        id: 'c1',
        source_id: sourceA,
        ordinal: 1,
        content: 'Solar verdoppelte sich.',
        token_count: 6,
      },
    ],
  };
}

function chatModel(value: unknown = script) {
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

function embeddingModel() {
  return new MockEmbeddingModelV4({
    maxEmbeddingsPerCall: 2048,
    doEmbed: ({ values }) =>
      Promise.resolve({
        embeddings: values.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.5)),
        usage: { tokens: 1 },
        warnings: [],
      }),
  });
}

class FakeTts implements DialogueSynthesizer {
  readonly requests: DialogueRequest[] = [];
  failures: Error[] = [];

  synthesize(request: DialogueRequest): Promise<Buffer> {
    this.requests.push(request);
    const failure = this.failures.shift();
    if (failure) return Promise.reject(failure);
    return Promise.resolve(Buffer.from(`audio-${request.inputs[0]?.text.slice(0, 1)}`));
  }
}

const fakeAudio: AudioTools = {
  async concatMp3(inputs, output) {
    const parts = await Promise.all(inputs.map((file) => readFile(file, 'utf8')));
    await writeFile(output, parts.join('+'));
  },
  durationSeconds: () => Promise.resolve(361.5),
};

function setup(
  options: {
    state?: Partial<FakeState>;
    deps?: Partial<PodcastPipelineDeps>;
    chat?: MockLanguageModelV4;
  } = {},
) {
  const { db, state } = fakeServiceDb(options.state ?? initialState());
  const tts = new FakeTts();
  const chat = options.chat ?? chatModel();
  const logs: string[] = [];
  const pipeline = new PodcastPipeline({
    db,
    models: { chat, embedding: embeddingModel() },
    tts,
    configError: null,
    voices: { A: 'fake-voice-a', B: 'fake-voice-b' },
    audio: fakeAudio,
    logger: {
      log: (message) => logs.push(message),
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message),
    },
    retryLimit: 2,
    ...options.deps,
  });
  const podcast = () => state.tables.podcasts?.[0];
  return { pipeline, state, tts, chat, logs, podcast };
}

const run = (retryCount = 0) => ({ retryCount, signal: new AbortController().signal });

describe('PodcastPipeline', () => {
  it('writes the script, synthesizes batches, joins and stores the episode', async () => {
    const { pipeline, state, tts, chat, podcast } = setup();
    await pipeline.run(job, run());

    expect(podcast()).toMatchObject({
      status: 'ready',
      error: null,
      title: 'Solarboom',
      script,
      storage_path: `${folder}/podcast.mp3`,
      duration_seconds: 361.5,
    });
    const statuses = state.log
      .filter((entry) => entry.target === 'podcasts' && entry.op === 'update')
      .map((entry) => (entry.payload as { status?: string }).status)
      .filter(Boolean);
    expect(statuses).toEqual(['scripting', 'synthesizing', 'ready']);

    // the script prompt is grounded in the retrieved chunks, in document order, in German
    const prompt = JSON.stringify(chat.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain('German (Deutsch)');
    expect(prompt.indexOf('Solar verdoppelte sich.')).toBeLessThan(
      prompt.indexOf('Speicher wurden billiger.'),
    );
    const rpc = state.log.find((entry) => entry.target === 'rpc:match_chunks');
    expect(rpc?.payload).toMatchObject({
      p_notebook_id: notebookId,
      p_source_ids: [sourceA],
      p_user_id: userId,
      p_query_text: 'Solarenergie',
      p_match_count: 30,
    });

    // two batches below the 2,000 character limit, both in the podcast language
    expect(tts.requests.map((request) => request.inputs.map((input) => input.voice_id))).toEqual([
      ['fake-voice-a', 'fake-voice-b'],
      ['fake-voice-a'],
    ]);
    expect(tts.requests.every((request) => request.languageCode === 'de')).toBe(true);

    // the episode is stored, the batch cache is cleaned up
    expect(state.storage.get(`${folder}/podcast.mp3`)?.toString()).toBe('audio-a+audio-c');
    expect([...state.storage.keys()]).toEqual([`${folder}/podcast.mp3`]);
  });

  it('scopes every service-role query to the job owner', async () => {
    const { pipeline, state } = setup();
    await pipeline.run(job, run());
    for (const entry of state.log.filter((e) => !e.target.includes(':'))) {
      const scoped = entry.filters.some(
        ([kind, column, value]) => kind === 'eq' && column === 'user_id' && value === userId,
      );
      expect(scoped, `${entry.target} ${entry.op} filters by user_id`).toBe(true);
    }
  });

  it('ignores podcasts of other users', async () => {
    const { pipeline, tts, podcast } = setup({
      state: initialState(podcastRow({ user_id: otherUser })),
    });
    await pipeline.run(job, run());
    expect(tts.requests).toHaveLength(0);
    expect(podcast()?.status).toBe('queued');
  });

  it('resumes from the stored script and cached batches', async () => {
    const state = initialState(podcastRow({ status: 'synthesizing', script, title: 'Solarboom' }));
    state.storage = new Map([[`${folder}/batch-0.mp3`, Buffer.from('cached-0')]]);
    const { pipeline, tts, chat, podcast, state: after } = setup({ state });
    await pipeline.run(job, run(1));

    expect(chat.doGenerateCalls).toHaveLength(0);
    expect(tts.requests).toHaveLength(1);
    expect(tts.requests[0]?.inputs[0]?.text.startsWith('c')).toBe(true);
    expect(after.storage.get(`${folder}/podcast.mp3`)?.toString()).toBe('cached-0+audio-c');
    expect(podcast()?.status).toBe('ready');
  });

  it('caches finished batches so a failed attempt can resume', async () => {
    const { pipeline, tts, state, podcast } = setup();
    // first batch succeeds, the second fails with a retryable error
    const original = tts.synthesize.bind(tts);
    let calls = 0;
    tts.synthesize = (request) => {
      calls++;
      if (calls === 2) return Promise.reject(new ElevenLabsError('busy', 429, true));
      return original(request);
    };
    await expect(pipeline.run(job, run(0))).rejects.toThrow(/busy/);
    expect(podcast()?.status).toBe('synthesizing');
    expect(state.storage.has(`${folder}/batch-0.mp3`)).toBe(true);
  });

  it('marks the podcast failed on the last attempt', async () => {
    const { pipeline, tts, podcast } = setup();
    tts.failures = [new ElevenLabsError('busy', 429, true)];
    await pipeline.run(job, run(2));
    expect(podcast()).toMatchObject({ status: 'failed', error: MESSAGES.generic });
  });

  it('fails without retry when ElevenLabs rejects the request', async () => {
    const { pipeline, tts, podcast } = setup();
    tts.failures = [new ElevenLabsError('failed with 401: invalid api key', 401, false)];
    await pipeline.run(job, run(0));
    expect(podcast()).toMatchObject({ status: 'failed', error: MESSAGES.ttsRejected });
  });

  it('fails clearly before writing a script when ElevenLabs is not configured', async () => {
    const { pipeline, chat, podcast, logs } = setup({
      deps: { tts: null, configError: 'missing ELEVENLABS_API_KEY' },
    });
    await pipeline.run(job, run(0));
    expect(chat.doGenerateCalls).toHaveLength(0);
    expect(podcast()).toMatchObject({ status: 'failed', error: MESSAGES.notConfigured });
    expect(logs.join('\n')).toContain('not configured');
  });

  it('needs voice B for dialogues but not for monologues', async () => {
    const dialogue = setup({ deps: { voices: { A: 'fake-voice-a', B: undefined } } });
    await dialogue.pipeline.run(job, run(0));
    expect(dialogue.podcast()).toMatchObject({ status: 'failed', error: MESSAGES.notConfigured });

    const monologue = setup({
      state: initialState(podcastRow({ mode: 'monologue' })),
      deps: { voices: { A: 'fake-voice-a', B: undefined } },
      chat: chatModel({ title: 'Solo', segments: [{ speaker: 'A', text: 'Hallo zusammen.' }] }),
    });
    await monologue.pipeline.run(job, run(0));
    expect(monologue.podcast()?.status).toBe('ready');
    expect(monologue.tts.requests[0]?.inputs).toEqual([
      { text: 'Hallo zusammen.', voice_id: 'fake-voice-a' },
    ]);
  });

  it('fails when the sources have no matching text', async () => {
    const state = initialState();
    state.matchChunks = [];
    const { pipeline, podcast } = setup({ state });
    await pipeline.run(job, run(0));
    expect(podcast()).toMatchObject({ status: 'failed', error: MESSAGES.noContent });
  });

  it('stops quietly when the podcast was deleted', async () => {
    const { pipeline, tts, state } = setup({ state: initialState(null) });
    await pipeline.run(job, run(0));
    expect(tts.requests).toHaveLength(0);
    expect(state.log.filter((entry) => entry.op === 'update')).toHaveLength(0);
  });

  it('stops and cleans up when the notebook was deleted', async () => {
    const state = initialState();
    state.tables = { ...state.tables, notebooks: [] };
    state.storage = new Map([[`${folder}/batch-0.mp3`, Buffer.from('x')]]);
    const { pipeline, tts, state: after } = setup({ state });
    await pipeline.run(job, run(0));
    expect(tts.requests).toHaveLength(0);
    expect(after.storage.size).toBe(0);
  });

  it('skips podcasts that are already done', async () => {
    const { pipeline, tts } = setup({ state: initialState(podcastRow({ status: 'ready' })) });
    await pipeline.run(job, run(0));
    expect(tts.requests).toHaveLength(0);
  });
});
