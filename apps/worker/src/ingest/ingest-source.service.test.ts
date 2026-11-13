import { readFileSync } from 'node:fs';
import { type AiModels, EMBEDDING_DIMENSIONS } from '@notebook-lite/ai';
import type { JobContext } from '@notebook-lite/queue';
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { FakeServiceDb } from '../testing/fake-service-db.js';
import { IngestError } from './errors.js';
import { GENERIC_FAILURE, IngestSourceService } from './ingest-source.service.js';
import type { UrlFetcher } from './url-fetcher.js';

const userId = '3a1e6c8f-5b2d-4f0a-9c7e-1d2b3c4d5e6f';
const notebookId = '7f4c1a52-2b8e-4a83-9d4e-0d6e5c3b2a10';
const sourceId = '0b6f2f3e-8a1d-4c55-9a0e-3d2c1b0a9f8e';
const job = { sourceId, notebookId, userId };
const folder = `${userId}/${notebookId}/${sourceId}`;

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
}

function context(retryCount = 0, signal = new AbortController().signal): JobContext {
  return { id: 'job-1', retryCount, signal };
}

interface Setup {
  kind?: string;
  fileName?: string;
  file?: Uint8Array;
  url?: string;
  status?: string;
  storagePath?: string;
  fetchPage?: UrlFetcher['fetchPage'];
  embed?: (values: string[]) => void;
}

function setup(options: Setup = {}) {
  const db = new FakeServiceDb();
  const kind = options.kind ?? 'md';
  const fileName = options.fileName ?? 'notes.md';
  const storagePath = kind === 'url' ? null : (options.storagePath ?? `${folder}/${fileName}`);
  db.tables['sources'] = [
    {
      id: sourceId,
      notebook_id: notebookId,
      user_id: userId,
      kind,
      title: kind === 'url' ? 'example.com/post' : 'notes',
      storage_path: storagePath,
      original_url: options.url ?? null,
      status: options.status ?? 'pending',
      error: null,
    },
  ];
  if (storagePath && options.file !== undefined) {
    db.objects.set(`sources/${storagePath}`, options.file);
  }

  const statuses: unknown[] = [];
  const embedding = new MockEmbeddingModelV4({
    maxEmbeddingsPerCall: 2048,
    doEmbed: ({ values }) => {
      options.embed?.(values);
      return Promise.resolve({
        embeddings: values.map((_, i) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => i)),
        usage: { tokens: values.length },
        warnings: [],
      });
    },
  });
  const models: AiModels = { chat: new MockLanguageModelV4(), embedding };
  const fetchPage = vi.fn<UrlFetcher['fetchPage']>(
    options.fetchPage ?? (() => Promise.reject(new Error('unexpected fetch'))),
  );
  const fetcher = { fetchPage } as unknown as UrlFetcher;

  db.beforeQuery = (table, action) => {
    if (table === 'sources' && action === 'update') {
      // Records the status sequence before the update is applied (see below).
      queueMicrotask(() => statuses.push(source()?.['status']));
    }
    return undefined;
  };
  const source = () => db.tables['sources']?.find((row) => row['id'] === sourceId);
  const chunks = () => db.tables['source_chunks'] ?? [];
  const service = new IngestSourceService(db.client, models, fetcher);
  return { db, service, embedding, fetchPage, statuses, source, chunks };
}

const failing = () => {
  throw new Error('OpenAI 503');
};

describe('IngestSourceService', () => {
  it('ingests a Markdown file: chunks with embeddings, then ready with title and tokens', async () => {
    const { service, source, chunks, statuses } = setup({ file: fixture('notes.md') });
    await service.run(job, context());

    expect(statuses).toEqual(['processing', 'ready']);
    expect(source()).toMatchObject({
      status: 'ready',
      error: null,
      title: 'Harbour Notes',
      page_count: null,
    });
    expect(chunks().length).toBeGreaterThan(0);
    const [first] = chunks();
    expect(first).toMatchObject({
      source_id: sourceId,
      notebook_id: notebookId,
      user_id: userId,
      ordinal: 0,
      page_start: null,
      fts: '',
    });
    expect(String(first?.['content'])).toContain('The harbour was dredged in 1952.');
    expect(String(first?.['embedding'])).toMatch(/^\[0(,0){3071}\]$/);
    const tokens = chunks().reduce((sum, chunk) => sum + Number(chunk['token_count']), 0);
    expect(source()?.['token_count']).toBe(tokens);
  });

  it('ingests a PDF with page numbers, page count and metadata title', async () => {
    const { service, source, chunks } = setup({
      kind: 'pdf',
      fileName: 'two-pages.pdf',
      file: fixture('two-pages.pdf'),
    });
    await service.run(job, context());
    expect(source()).toMatchObject({ status: 'ready', page_count: 2, title: 'Harbour Chronicle' });
    expect(chunks()[0]).toMatchObject({ page_start: 1, page_end: 2 });
  });

  it('replaces chunks of earlier attempts and leaves other sources alone', async () => {
    const { db, service, chunks } = setup({ file: fixture('notes.md') });
    db.tables['source_chunks'] = [
      { id: 'old', source_id: sourceId, notebook_id: notebookId, user_id: userId, ordinal: 0 },
      { id: 'other', source_id: 'other', notebook_id: notebookId, user_id: userId, ordinal: 0 },
    ];
    await service.run(job, context());
    const ids = chunks().map((chunk) => chunk['id']);
    expect(ids).not.toContain('old');
    expect(ids).toContain('other');
  });

  it('skips sources that no longer exist or are already ready', async () => {
    const gone = setup({ file: fixture('notes.md') });
    gone.db.tables['sources'] = [];
    await gone.service.run(job, context());
    expect(gone.embedding.doEmbedCalls).toHaveLength(0);

    const ready = setup({ file: fixture('notes.md'), status: 'ready' });
    await ready.service.run(job, context());
    expect(ready.embedding.doEmbedCalls).toHaveLength(0);
  });

  it('only reads sources of the job’s user', async () => {
    const { service, embedding } = setup({ file: fixture('notes.md') });
    await service.run({ ...job, userId: '99999999-9999-4999-a999-999999999999' }, context());
    expect(embedding.doEmbedCalls).toHaveLength(0);
  });

  it('marks scanned PDFs as failed with a readable reason, without retrying', async () => {
    const { service, source, chunks, embedding } = setup({
      kind: 'pdf',
      fileName: 'scanned.pdf',
      file: fixture('scanned.pdf'),
    });
    await expect(service.run(job, context())).resolves.toBeUndefined();
    expect(source()).toMatchObject({ status: 'failed' });
    expect(String(source()?.['error'])).toMatch(/no extractable text/);
    expect(chunks()).toHaveLength(0);
    expect(embedding.doEmbedCalls).toHaveLength(0);
  });

  it('fails when the uploaded file is missing', async () => {
    const { service, source } = setup();
    await service.run(job, context());
    expect(source()).toMatchObject({
      status: 'failed',
      error: 'The uploaded file is missing. Please upload it again.',
    });
  });

  it('never reads objects outside the source’s own folder', async () => {
    const other = `${userId}/${notebookId}/another-source/secret.md`;
    const { db, service, source } = setup({ storagePath: other });
    db.objects.set(`sources/${other}`, fixture('notes.md'));
    await service.run(job, context());
    expect(source()).toMatchObject({ status: 'failed' });
  });

  it('fetches URL sources, stores a Markdown snapshot and uses the page title', async () => {
    const html = `<html><head><title>Lighthouse news</title></head><body><article>${'<p>The lighthouse opened on Monday after two years of work on the northern cliff.</p>'.repeat(5)}</article></body></html>`;
    const { db, service, source, chunks, fetchPage } = setup({
      kind: 'url',
      url: 'https://example.com/post',
      fetchPage: () => Promise.resolve({ url: 'https://example.com/post', html }),
    });
    await service.run(job, context());

    expect(fetchPage).toHaveBeenCalledWith('https://example.com/post', expect.any(AbortSignal));
    const snapshotPath = `${folder}/snapshot.md`;
    expect(db.uploads).toEqual([{ path: `sources/${snapshotPath}`, contentType: 'text/markdown' }]);
    const snapshot = new TextDecoder().decode(db.objects.get(`sources/${snapshotPath}`));
    expect(snapshot).toContain('The lighthouse opened on Monday');
    expect(source()).toMatchObject({
      status: 'ready',
      title: 'Lighthouse news',
      storage_path: snapshotPath,
      mime_type: 'text/markdown',
      size_bytes: new TextEncoder().encode(snapshot).length,
    });
    expect(chunks().length).toBeGreaterThan(0);
  });

  it('reports blocked or unreachable URLs on the source', async () => {
    const { service, source } = setup({
      kind: 'url',
      url: 'http://internal.example.com/',
      fetchPage: () =>
        Promise.reject(
          new IngestError('This address is not allowed (private or internal network).'),
        ),
    });
    await service.run(job, context());
    expect(source()).toMatchObject({
      status: 'failed',
      error: 'This address is not allowed (private or internal network).',
    });
  });

  it('stops quietly when the source is deleted during processing', async () => {
    let db: FakeServiceDb | undefined;
    const run = setup({
      kind: 'url',
      url: 'https://example.com/post',
      fetchPage: () =>
        Promise.resolve({
          url: 'https://example.com/post',
          html: '<html><body><p>Some text about the harbour.</p></body></html>',
        }),
      embed: () => {
        // The user deletes the source (or its notebook) while embeddings are computed.
        if (db) db.tables['sources'] = [];
      },
    });
    db = run.db;
    await expect(run.service.run(job, context())).resolves.toBeUndefined();
    expect(run.chunks()).toHaveLength(0);
    expect(run.db.objects.size).toBe(0); // the snapshot is removed again
  });

  it('stops quietly when the deletion surfaces as a foreign key error', async () => {
    const run = setup({ file: fixture('notes.md') });
    run.db.beforeQuery = (table, action) => {
      if (table === 'source_chunks' && action === 'insert') run.db.tables['sources'] = [];
      return undefined;
    };
    await expect(run.service.run(job, context())).resolves.toBeUndefined();
  });

  it('retries transient errors and reports them after the last attempt', async () => {
    const first = setup({ file: fixture('notes.md'), embed: failing });
    await expect(first.service.run(job, context(0))).rejects.toThrow('OpenAI 503');
    expect(first.source()).toMatchObject({ status: 'pending', error: null });

    const last = setup({ file: fixture('notes.md'), embed: failing });
    await expect(last.service.run(job, context(3))).rejects.toThrow('OpenAI 503');
    expect(last.source()).toMatchObject({ status: 'failed', error: GENERIC_FAILURE });
  });

  it('treats an aborted job (expiry or shutdown) as transient', async () => {
    const controller = new AbortController();
    const run = setup({
      file: fixture('notes.md'),
      embed: () => {
        controller.abort(new Error('job expired'));
        throw new Error('aborted');
      },
    });
    await expect(run.service.run(job, context(0, controller.signal))).rejects.toThrow('aborted');
    expect(run.source()).toMatchObject({ status: 'pending' });
  });
});
