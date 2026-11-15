import type { Db } from '../supabase/types.js';

export interface FakeResult {
  data: unknown;
  error: { code: string; message: string } | null;
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
