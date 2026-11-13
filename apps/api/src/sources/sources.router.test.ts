import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../auth/auth.types.js';
import { fakeDb, type FakeResult } from '../testing/fake-db.js';
import { fakeJobs, testContext } from '../testing/fixtures.js';
import { appRouter } from '../trpc/app-router.js';
import type { JobSender } from '../trpc/context.js';

const userId = '3a1e6c8f-5b2d-4f0a-9c7e-1d2b3c4d5e6f';
const user: AuthUser = { id: userId, email: 'u@example.com', accessToken: 'token' };
const notebookId = '7f4c1a52-2b8e-4a83-9d4e-0d6e5c3b2a10';
const sourceId = '0b6f2f3e-8a1d-4c55-9a0e-3d2c1b0a9f8e';

const row = {
  id: sourceId,
  notebook_id: notebookId,
  kind: 'pdf',
  title: 'Report',
  original_url: null,
  mime_type: 'application/pdf',
  size_bytes: 1234,
  status: 'pending',
  error: null,
  page_count: null,
  token_count: null,
  created_at: '2026-11-13T10:00:00+00:00',
  updated_at: '2026-11-13T10:00:00+00:00',
};

const source = {
  id: sourceId,
  notebookId,
  kind: 'pdf',
  title: 'Report',
  originalUrl: null,
  mimeType: 'application/pdf',
  sizeBytes: 1234,
  status: 'pending',
  error: null,
  pageCount: null,
  tokenCount: null,
  createdAt: '2026-11-13T10:00:00+00:00',
  updatedAt: '2026-11-13T10:00:00+00:00',
};

function callerWith(results: FakeResult[], jobs: JobSender = fakeJobs()) {
  const fake = fakeDb(...results);
  return {
    caller: appRouter.createCaller(testContext({ user, supabase: fake.db, jobs })),
    ...fake,
  };
}

async function trpcCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TRPCError) return error.code;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('sources router', () => {
  it('requires a session', async () => {
    const caller = appRouter.createCaller(
      testContext({ user: null, supabase: null, jobs: fakeJobs() }),
    );
    expect(await trpcCode(caller.sources.list({ notebookId }))).toBe('UNAUTHORIZED');
  });

  it('lists a notebook’s sources, newest first', async () => {
    const { caller, queries } = callerWith([{ data: [row], error: null }]);
    await expect(caller.sources.list({ notebookId })).resolves.toEqual([source]);
    expect(queries[0]?.table).toBe('sources');
    expect(queries[0]?.ops).toContainEqual(['eq', ['notebook_id', notebookId]]);
    expect(queries[0]?.ops).toContainEqual(['order', ['created_at', { ascending: false }]]);
  });

  it('gets one source scoped by notebook, or NOT_FOUND', async () => {
    const found = callerWith([{ data: row, error: null }]);
    await expect(found.caller.sources.get({ notebookId, id: sourceId })).resolves.toEqual(source);
    expect(found.queries[0]?.ops).toContainEqual(['eq', ['notebook_id', notebookId]]);
    expect(found.queries[0]?.ops).toContainEqual(['eq', ['id', sourceId]]);

    const missing = callerWith([{ data: null, error: null }]);
    expect(await trpcCode(missing.caller.sources.get({ notebookId, id: sourceId }))).toBe(
      'NOT_FOUND',
    );
  });

  it('registers an upload under the caller’s path and queues ingestion', async () => {
    const jobs = fakeJobs();
    const { caller, queries } = callerWith([{ data: row, error: null }], jobs);
    await expect(
      caller.sources.create({
        id: sourceId,
        notebookId,
        kind: 'pdf',
        title: ' Report ',
        fileName: 'Report.pdf',
        sizeBytes: 1234,
      }),
    ).resolves.toEqual(source);

    expect(queries[0]?.ops[0]).toEqual([
      'insert',
      [
        {
          id: sourceId,
          notebook_id: notebookId,
          kind: 'pdf',
          title: 'Report',
          storage_path: `${userId}/${notebookId}/${sourceId}/Report.pdf`,
          mime_type: 'application/pdf',
          size_bytes: 1234,
        },
      ],
    ]);
    expect(jobs.sent).toEqual([{ name: 'ingest-source', data: { sourceId, notebookId, userId } }]);
  });

  it('rejects unsafe file names and unsupported kinds before touching the database', async () => {
    const { caller, queries } = callerWith([]);
    const base = { id: sourceId, notebookId, title: 'x', sizeBytes: 1 };
    expect(
      await trpcCode(caller.sources.create({ ...base, kind: 'pdf', fileName: '../other/x.pdf' })),
    ).toBe('BAD_REQUEST');
    expect(
      // @ts-expect-error url is not a file kind
      await trpcCode(caller.sources.create({ ...base, kind: 'url', fileName: 'x.pdf' })),
    ).toBe('BAD_REQUEST');
    expect(queries).toHaveLength(0);
  });

  it('maps a missing notebook to NOT_FOUND and a duplicate id to CONFLICT', async () => {
    const input = {
      id: sourceId,
      notebookId,
      kind: 'md' as const,
      title: 'x',
      fileName: 'x.md',
      sizeBytes: 1,
    };
    const fk = callerWith([{ data: null, error: { code: '23503', message: 'fk' } }]);
    expect(await trpcCode(fk.caller.sources.create(input))).toBe('NOT_FOUND');
    const dup = callerWith([{ data: null, error: { code: '23505', message: 'dup' } }]);
    expect(await trpcCode(dup.caller.sources.create(input))).toBe('CONFLICT');
  });

  it('adds a URL source with a placeholder title and queues ingestion', async () => {
    const jobs = fakeJobs();
    const urlRow = {
      ...row,
      kind: 'url',
      title: 'example.com/post',
      original_url: 'https://example.com/post',
      mime_type: null,
      size_bytes: null,
    };
    const { caller, queries } = callerWith([{ data: urlRow, error: null }], jobs);
    const created = await caller.sources.createFromUrl({
      notebookId,
      url: 'https://example.com/post',
    });
    expect(created.kind).toBe('url');
    expect(queries[0]?.ops[0]).toEqual([
      'insert',
      [
        {
          notebook_id: notebookId,
          kind: 'url',
          title: 'example.com/post',
          original_url: 'https://example.com/post',
        },
      ],
    ]);
    expect(jobs.sent).toHaveLength(1);
  });

  it('rejects non-http URLs', async () => {
    const { caller, queries } = callerWith([]);
    const urls = ['file:///etc/passwd', 'ftp://example.com', 'https://a:b@example.com'];
    const codes = await Promise.all(
      urls.map((url) => trpcCode(caller.sources.createFromUrl({ notebookId, url }))),
    );
    expect(codes).toEqual(['BAD_REQUEST', 'BAD_REQUEST', 'BAD_REQUEST']);
    expect(queries).toHaveLength(0);
  });

  it('removes the row again when the job cannot be queued', async () => {
    const failing: JobSender = { send: () => Promise.reject(new Error('queue down')) };
    const { caller, queries } = callerWith(
      [
        { data: row, error: null },
        { data: null, error: null },
      ],
      failing,
    );
    await expect(
      caller.sources.createFromUrl({ notebookId, url: 'https://example.com' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(queries[1]?.ops).toEqual([
      ['delete', []],
      ['eq', ['id', sourceId]],
    ]);
  });

  it('deletes the Storage objects, then the row', async () => {
    const { caller, queries, storage, events } = callerWith([
      { data: { id: sourceId }, error: null },
      { data: { id: sourceId }, error: null },
    ]);
    const folder = `${userId}/${notebookId}/${sourceId}`;
    storage.put('sources', `${folder}/Report.pdf`, `${userId}/${notebookId}/other/keep.md`);

    await expect(caller.sources.delete({ notebookId, id: sourceId })).resolves.toEqual({
      id: sourceId,
    });
    expect(storage.removed).toEqual([{ bucket: 'sources', paths: [`${folder}/Report.pdf`] }]);
    expect(storage.objects.get('sources')?.has(`${userId}/${notebookId}/other/keep.md`)).toBe(true);
    expect(events).toEqual([
      'db:sources',
      'storage.list:sources',
      'storage.remove:sources',
      'db:sources',
    ]);
    expect(queries[1]?.ops).toContainEqual(['delete', []]);
    expect(queries[1]?.ops).toContainEqual(['eq', ['notebook_id', notebookId]]);
  });

  it('returns NOT_FOUND when deleting a source the user cannot see', async () => {
    const { caller, events } = callerWith([{ data: null, error: null }]);
    expect(await trpcCode(caller.sources.delete({ notebookId, id: sourceId }))).toBe('NOT_FOUND');
    expect(events).toEqual(['db:sources']);
  });

  it('keeps the row when Storage cleanup fails', async () => {
    const { caller, storage, events } = callerWith([{ data: { id: sourceId }, error: null }]);
    storage.failWith = new Error('storage down');
    await expect(caller.sources.delete({ notebookId, id: sourceId })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Storage error',
    });
    expect(events).not.toContain('storage.remove:sources');
    expect(events.filter((e) => e === 'db:sources')).toHaveLength(1);
  });
});
