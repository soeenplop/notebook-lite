import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../auth/auth.types.js';
import { fakeDb, type FakeResult } from '../testing/fake-db.js';
import { testContext } from '../testing/fixtures.js';
import { appRouter } from '../trpc/app-router.js';

const user: AuthUser = { id: 'user-1', email: 'u@example.com', accessToken: 'token' };
const notebookId = '7f4c1a52-2b8e-4a83-9d4e-0d6e5c3b2a10';

const row = {
  id: notebookId,
  name: 'Research',
  description: null,
  language: 'de',
  created_at: '2026-11-12T21:00:00.123456+00:00',
  updated_at: '2026-11-12T21:05:00+00:00',
  sources: [{ count: 3 }],
  chats: [{ count: 1 }],
  podcasts: [],
};

const summary = {
  id: notebookId,
  name: 'Research',
  description: null,
  language: 'de',
  createdAt: '2026-11-12T21:00:00.123456+00:00',
  updatedAt: '2026-11-12T21:05:00+00:00',
  counts: { sources: 3, chats: 1, podcasts: 0 },
};

function callerWith(...results: FakeResult[]) {
  const { db, queries } = fakeDb(...results);
  return { caller: appRouter.createCaller(testContext({ user, supabase: db })), queries };
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

describe('notebooks router', () => {
  it('requires a session', async () => {
    const caller = appRouter.createCaller(testContext());
    expect(await trpcCode(caller.notebooks.list())).toBe('UNAUTHORIZED');
  });

  it('lists notebooks with counts, most recently updated first', async () => {
    const { caller, queries } = callerWith({ data: [row], error: null });
    await expect(caller.notebooks.list()).resolves.toEqual([summary]);
    expect(queries[0]?.table).toBe('notebooks');
    expect(queries[0]?.ops).toContainEqual(['order', ['updated_at', { ascending: false }]]);
  });

  it('gets one notebook or NOT_FOUND', async () => {
    const found = callerWith({ data: row, error: null });
    await expect(found.caller.notebooks.get({ id: notebookId })).resolves.toEqual(summary);
    expect(found.queries[0]?.ops).toContainEqual(['eq', ['id', notebookId]]);

    const missing = callerWith({ data: null, error: null });
    expect(await trpcCode(missing.caller.notebooks.get({ id: notebookId }))).toBe('NOT_FOUND');
  });

  it('creates a notebook from validated input', async () => {
    const { caller, queries } = callerWith({ data: row, error: null });
    await caller.notebooks.create({ name: '  Research ', description: ' ', language: 'de' });
    expect(queries[0]?.ops[0]).toEqual([
      'insert',
      [{ name: 'Research', description: null, language: 'de' }],
    ]);
  });

  it('rejects invalid input before touching the database', async () => {
    const { caller, queries } = callerWith();
    expect(await trpcCode(caller.notebooks.create({ name: '', language: 'de' }))).toBe(
      'BAD_REQUEST',
    );
    expect(
      // @ts-expect-error unsupported language
      await trpcCode(caller.notebooks.create({ name: 'x', language: 'fr' })),
    ).toBe('BAD_REQUEST');
    expect(await trpcCode(caller.notebooks.get({ id: 'not-a-uuid' }))).toBe('BAD_REQUEST');
    expect(queries).toHaveLength(0);
  });

  it('updates only the given fields', async () => {
    const { caller, queries } = callerWith({ data: row, error: null });
    await caller.notebooks.update({ id: notebookId, language: 'en' });
    expect(queries[0]?.ops[0]).toEqual(['update', [{ language: 'en' }]]);
    expect(queries[0]?.ops).toContainEqual(['eq', ['id', notebookId]]);
  });

  it('returns NOT_FOUND when updating or deleting a notebook the user cannot see', async () => {
    const update = callerWith({ data: null, error: null });
    expect(await trpcCode(update.caller.notebooks.update({ id: notebookId, name: 'x' }))).toBe(
      'NOT_FOUND',
    );
    const remove = callerWith({ data: null, error: null });
    expect(await trpcCode(remove.caller.notebooks.delete({ id: notebookId }))).toBe('NOT_FOUND');
  });

  it('deletes a notebook', async () => {
    const { caller, queries } = callerWith({ data: { id: notebookId }, error: null });
    await expect(caller.notebooks.delete({ id: notebookId })).resolves.toEqual({ id: notebookId });
    expect(queries[0]?.ops[0]).toEqual(['delete', []]);
  });

  it('maps database errors without leaking details', async () => {
    const check = callerWith({ data: null, error: { code: '23514', message: 'violates check' } });
    expect(await trpcCode(check.caller.notebooks.list())).toBe('BAD_REQUEST');

    const unknown = callerWith({ data: null, error: { code: 'XX000', message: 'secret detail' } });
    await expect(unknown.caller.notebooks.list()).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Database error',
    });
  });
});
