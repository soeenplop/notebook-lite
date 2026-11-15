import type { Db } from '../supabase/types.js';

export interface FakeResult {
  data: unknown;
  error: { code: string; message: string } | null;
}

export interface RecordedQuery {
  /** Table name, or `rpc:<function>` for `db.rpc(...)` calls. */
  table: string;
  /** Builder calls in order, e.g. [['select', ['id']], ['eq', ['id', '…']]]. */
  ops: [method: string, args: unknown[]][];
}

/**
 * Minimal stand-in for a Supabase client: `from(table)` and `rpc(fn, args)` return a chainable
 * builder that records every call and resolves to the next queued result when awaited (results
 * are consumed in the order the queries are started). Enough to unit-test repository and router
 * logic; RLS itself is covered by the pgTAP tests.
 */
export function fakeDb(...results: FakeResult[]): { db: Db; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  let next = 0;

  const record = (table: string, ops: RecordedQuery['ops']): object => {
    const query: RecordedQuery = { table, ops };
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
  };

  const client = {
    from: (table: string) => record(table, []),
    rpc: (fn: string, args: unknown) => record(`rpc:${fn}`, [['rpc', [args]]]),
  };

  return { db: client as unknown as Db, queries };
}
