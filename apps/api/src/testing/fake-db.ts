import type { Db } from '../supabase/types.js';

export interface FakeResult {
  data: unknown;
  error: { code: string; message: string } | null;
  /** Row count for `select(…, { count: 'exact' })` queries. */
  count?: number | null;
}

export interface RecordedQuery {
  table: string;
  /** Builder calls in order, e.g. [['select', ['id']], ['eq', ['id', '…']]]. */
  ops: [method: string, args: unknown[]][];
}

/**
 * Minimal stand-in for a Supabase client: `from(table)` returns a chainable builder that records
 * every call and resolves to the next queued result when awaited. Enough to unit-test repository
 * and router logic; RLS itself is covered by the pgTAP tests.
 */
export function fakeDb(...results: FakeResult[]): { db: Db; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  let next = 0;

  const client = {
    from(table: string) {
      const query: RecordedQuery = { table, ops: [] };
      queries.push(query);
      const result = results[next++] ?? { data: null, error: null };
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') {
              return (
                onFulfilled?: (value: FakeResult) => unknown,
                onRejected?: (reason: unknown) => unknown,
              ) => Promise.resolve(result).then(onFulfilled, onRejected);
            }
            return (...args: unknown[]) => {
              query.ops.push([String(prop), args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };

  return { db: client as unknown as Db, queries };
}

export interface RecordedStorageCall {
  bucket: string;
  method: string;
  args: unknown[];
}

/**
 * Adds a fake `storage` to a fake client: every `storage.from(bucket).<method>(…)` call is
 * recorded and resolves to the next queued result.
 */
export function withFakeStorage(
  db: Db,
  ...results: FakeResult[]
): { db: Db; calls: RecordedStorageCall[] } {
  const calls: RecordedStorageCall[] = [];
  let next = 0;
  const storage = {
    from: (bucket: string) =>
      new Proxy(
        {},
        {
          get:
            (_target, method) =>
            (...args: unknown[]) => {
              calls.push({ bucket, method: String(method), args });
              return Promise.resolve(results[next++] ?? { data: null, error: null });
            },
        },
      ),
  };
  Object.assign(db, { storage });
  return { db, calls };
}
