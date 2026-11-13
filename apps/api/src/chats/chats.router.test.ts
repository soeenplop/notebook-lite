import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../auth/auth.types.js';
import { fakeDb, type FakeResult } from '../testing/fake-db.js';
import { fakeJobs, testContext } from '../testing/fixtures.js';
import { appRouter } from '../trpc/app-router.js';

const user: AuthUser = { id: 'user-1', email: 'u@example.com', accessToken: 'token' };
const notebookId = '7f4c1a52-2b8e-4a83-9d4e-0d6e5c3b2a10';
const chatId = '3c2b1a09-8f7e-4d6c-9b5a-4c3d2e1f0a9b';
const sourceA = '0b0c6d1e-3f4a-4b5c-8d6e-7f8091a2b3c4';
const sourceB = '1c1d7e2f-4a5b-4c6d-9e7f-8091a2b3c4d5';
const chunkId = '5e4d3c2b-1a09-4f8e-8d7c-6b5a49382716';
const messageId = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const chatRow = {
  id: chatId,
  notebook_id: notebookId,
  title: null,
  created_at: '2026-11-13T10:00:00+00:00',
  updated_at: '2026-11-13T10:05:00.5+00:00',
};

const summary = {
  id: chatId,
  notebookId,
  title: null,
  createdAt: '2026-11-13T10:00:00+00:00',
  updatedAt: '2026-11-13T10:05:00.5+00:00',
};

function callerWith(...results: FakeResult[]) {
  const { db, queries } = fakeDb(...results);
  return {
    caller: appRouter.createCaller(testContext({ user, supabase: db, jobs: fakeJobs() })),
    queries,
  };
}

const ok = (data: unknown): FakeResult => ({ data, error: null });

async function trpcCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TRPCError) return error.code;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('chats router', () => {
  it('requires a session', async () => {
    const caller = appRouter.createCaller(
      testContext({ user: null, supabase: null, jobs: fakeJobs() }),
    );
    expect(await trpcCode(caller.chats.list({ notebookId }))).toBe('UNAUTHORIZED');
  });

  it('lists the notebook chats, most recently active first', async () => {
    const { caller, queries } = callerWith(ok([chatRow]));
    await expect(caller.chats.list({ notebookId })).resolves.toEqual([summary]);
    expect(queries[0]?.table).toBe('chats');
    expect(queries[0]?.ops).toContainEqual(['eq', ['notebook_id', notebookId]]);
    expect(queries[0]?.ops).toContainEqual(['order', ['updated_at', { ascending: false }]]);
  });

  it('gets a chat with every notebook source, its selection and the messages', async () => {
    const citation = {
      marker: 1,
      chunkId,
      sourceId: sourceA,
      sourceTitle: 'Paper',
      page: 3,
      quote: 'Water boils at 100 °C.',
    };
    const { caller, queries } = callerWith(
      ok({ ...chatRow, chat_sources: [{ source_id: sourceA }] }),
      ok([
        { id: sourceA, title: 'Paper', kind: 'pdf', status: 'ready' },
        { id: sourceB, title: 'Notes', kind: 'md', status: 'processing' },
      ]),
      ok([
        {
          id: messageId,
          role: 'assistant',
          content: 'It boils at 100 °C [1].',
          citations: [citation],
          created_at: '2026-11-13T10:01:00+00:00',
        },
      ]),
    );
    const chat = await caller.chats.get({ id: chatId });
    expect(chat.sources).toEqual([
      { id: sourceA, title: 'Paper', kind: 'pdf', status: 'ready', selected: true },
      { id: sourceB, title: 'Notes', kind: 'md', status: 'processing', selected: false },
    ]);
    expect(chat.messages).toEqual([
      {
        id: messageId,
        role: 'assistant',
        content: 'It boils at 100 °C [1].',
        citations: [citation],
        createdAt: '2026-11-13T10:01:00+00:00',
      },
    ]);
    expect(queries[1]?.ops).toContainEqual(['eq', ['notebook_id', notebookId]]);
    expect(queries[2]?.ops).toContainEqual(['eq', ['chat_id', chatId]]);
  });

  it('returns NOT_FOUND for a chat the user cannot see', async () => {
    const { caller, queries } = callerWith(ok(null));
    expect(await trpcCode(caller.chats.get({ id: chatId }))).toBe('NOT_FOUND');
    expect(queries).toHaveLength(1);
  });

  it('creates a chat with all ready sources preselected', async () => {
    const { caller, queries } = callerWith(
      ok([{ id: sourceA }, { id: sourceB }]),
      ok(chatRow),
      ok(null),
    );
    await expect(caller.chats.create({ notebookId })).resolves.toEqual(summary);
    expect(queries[0]?.ops).toContainEqual(['eq', ['status', 'ready']]);
    expect(queries[1]?.ops[0]).toEqual(['insert', [{ notebook_id: notebookId }]]);
    expect(queries[2]?.table).toBe('chat_sources');
    expect(queries[2]?.ops[0]).toEqual([
      'insert',
      [
        [
          { chat_id: chatId, source_id: sourceA, notebook_id: notebookId },
          { chat_id: chatId, source_id: sourceB, notebook_id: notebookId },
        ],
      ],
    ]);
  });

  it('creates a chat without a selection when no source is ready', async () => {
    const { caller, queries } = callerWith(ok([]), ok(chatRow));
    await caller.chats.create({ notebookId });
    expect(queries).toHaveLength(2);
  });

  it('removes the chat again when preselecting sources fails', async () => {
    const { caller, queries } = callerWith(
      ok([{ id: sourceA }]),
      ok(chatRow),
      { data: null, error: { code: '42501', message: 'denied' } },
      ok(null),
    );
    expect(await trpcCode(caller.chats.create({ notebookId }))).toBe('FORBIDDEN');
    expect(queries[3]?.table).toBe('chats');
    expect(queries[3]?.ops).toEqual([
      ['delete', []],
      ['eq', ['id', chatId]],
    ]);
  });

  it('maps a foreign notebook to NOT_FOUND on create', async () => {
    const { caller } = callerWith(ok([]), { data: null, error: { code: '23503', message: 'fk' } });
    expect(await trpcCode(caller.chats.create({ notebookId }))).toBe('NOT_FOUND');
  });

  it('renames a chat with a trimmed title', async () => {
    const { caller, queries } = callerWith(ok({ ...chatRow, title: 'Boiling' }));
    await expect(caller.chats.rename({ id: chatId, title: '  Boiling ' })).resolves.toMatchObject({
      title: 'Boiling',
    });
    expect(queries[0]?.ops[0]).toEqual(['update', [{ title: 'Boiling' }]]);
  });

  it('deletes a chat or returns NOT_FOUND', async () => {
    const found = callerWith(ok({ id: chatId }));
    await expect(found.caller.chats.delete({ id: chatId })).resolves.toEqual({ id: chatId });
    const missing = callerWith(ok(null));
    expect(await trpcCode(missing.caller.chats.delete({ id: chatId }))).toBe('NOT_FOUND');
  });

  it('replaces the source selection', async () => {
    const { caller, queries } = callerWith(
      ok({ id: chatId, notebook_id: notebookId }),
      ok(null),
      ok(null),
    );
    await expect(
      caller.chats.setSources({ id: chatId, sourceIds: [sourceA, sourceB, sourceA] }),
    ).resolves.toEqual({ id: chatId, sourceIds: [sourceA, sourceB] });
    expect(queries[1]?.ops).toEqual([
      ['delete', []],
      ['eq', ['chat_id', chatId]],
      ['not', ['source_id', 'in', `(${sourceA},${sourceB})`]],
    ]);
    expect(queries[2]?.ops[0]).toEqual([
      'upsert',
      [
        [
          { chat_id: chatId, source_id: sourceA, notebook_id: notebookId },
          { chat_id: chatId, source_id: sourceB, notebook_id: notebookId },
        ],
        { onConflict: 'chat_id,source_id', ignoreDuplicates: true },
      ],
    ]);
  });

  it('clears the selection with an empty list', async () => {
    const { caller, queries } = callerWith(ok({ id: chatId, notebook_id: notebookId }), ok(null));
    await caller.chats.setSources({ id: chatId, sourceIds: [] });
    expect(queries).toHaveLength(2);
    expect(queries[1]?.ops).toEqual([
      ['delete', []],
      ['eq', ['chat_id', chatId]],
    ]);
  });

  it('loads a cited chunk or NOT_FOUND after its source was deleted', async () => {
    const { caller } = callerWith(
      ok({
        id: chunkId,
        source_id: sourceA,
        content: 'Water boils at 100 °C.',
        page_start: 3,
        page_end: 4,
        heading_path: ['Physics'],
        sources: { title: 'Paper' },
      }),
    );
    await expect(caller.chats.chunk({ chunkId })).resolves.toEqual({
      chunkId,
      sourceId: sourceA,
      sourceTitle: 'Paper',
      pageStart: 3,
      pageEnd: 4,
      headingPath: ['Physics'],
      content: 'Water boils at 100 °C.',
    });
    const gone = callerWith(ok(null));
    expect(await trpcCode(gone.caller.chats.chunk({ chunkId }))).toBe('NOT_FOUND');
  });

  it('validates input before touching the database', async () => {
    const { caller, queries } = callerWith();
    expect(await trpcCode(caller.chats.get({ id: 'nope' }))).toBe('BAD_REQUEST');
    expect(await trpcCode(caller.chats.rename({ id: chatId, title: ' ' }))).toBe('BAD_REQUEST');
    expect(await trpcCode(caller.chats.setSources({ id: chatId, sourceIds: ['x'] }))).toBe(
      'BAD_REQUEST',
    );
    expect(queries).toHaveLength(0);
  });
});
