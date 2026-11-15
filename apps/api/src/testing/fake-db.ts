import type { Db } from '../supabase/types.js';

export interface FakeResult {
  data: unknown;
  error: { code: string; message: string } | null;
  /** Row count for `select(…, { count: 'exact' })` queries. */
  count?: number | null;
}

export interface RecordedQuery {
  /** Table name, or `rpc:<function>` for `db.rpc(...)` calls. */
  table: string;
  /** Builder calls in order, e.g. [['select', ['id']], ['eq', ['id', '…']]]. */
  ops: [method: string, args: unknown[]][];
}

/**
 * In-memory Storage: `list` behaves like Supabase (one folder level, sub-folders as entries
 * with `id: null`), `remove` deletes exact paths. `failWith` makes every call fail.
 */
export interface FakeStorage {
  objects: Map<string, Set<string>>;
  put(bucket: string, ...paths: string[]): void;
  removed: { bucket: string; paths: string[] }[];
  failWith: Error | null;
}

/**
 * Minimal stand-in for a Supabase client: `from(table)` and `rpc(fn, args)` return a chainable builder that records
 * every call and resolves to the next queued result when awaited. Enough to unit-test repository
 * and router logic; RLS itself is covered by the pgTAP tests. `events` records the order of
 * table and Storage calls (`db:<table>`, `db:rpc:<fn>`, `storage.list:<bucket>`, `storage.remove:<bucket>`).
 */
export function fakeDb(...results: FakeResult[]): {
  db: Db;
  queries: RecordedQuery[];
  storage: FakeStorage;
  events: string[];
} {
  const queries: RecordedQuery[] = [];
  const events: string[] = [];
  let next = 0;

  const storage: FakeStorage = {
    objects: new Map(),
    put(bucket, ...paths) {
      const set = storage.objects.get(bucket) ?? new Set<string>();
      for (const path of paths) set.add(path);
      storage.objects.set(bucket, set);
    },
    removed: [],
    failWith: null,
  };

  const record = (table: string, ops: RecordedQuery['ops']): object => {
    events.push(`db:${table}`);
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
    from(table: string) {
      return record(table, []);
    },
    rpc(fn: string, args: unknown) {
      return record(`rpc:${fn}`, [['rpc', [args]]]);
    },
    storage: {
      from(bucket: string) {
        const all = () => [...(storage.objects.get(bucket) ?? [])];
        return {
          list(folder: string, options: { limit: number; offset: number }) {
            events.push(`storage.list:${bucket}`);
            if (storage.failWith) return Promise.resolve({ data: null, error: storage.failWith });
            const prefix = `${folder}/`;
            const entries = new Map<string, string | null>();
            for (const path of all().filter((p) => p.startsWith(prefix))) {
              const [name = '', ...rest] = path.slice(prefix.length).split('/');
              entries.set(name, rest.length > 0 ? null : `id-${path}`);
            }
            const data = [...entries]
              .toSorted(([a], [b]) => a.localeCompare(b))
              .slice(options.offset, options.offset + options.limit)
              .map(([name, id]) => ({ name, id }));
            return Promise.resolve({ data, error: null });
          },
          remove(paths: string[]) {
            events.push(`storage.remove:${bucket}`);
            if (storage.failWith) return Promise.resolve({ data: null, error: storage.failWith });
            storage.removed.push({ bucket, paths });
            for (const path of paths) storage.objects.get(bucket)?.delete(path);
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    },
  };

  return { db: client as unknown as Db, queries, storage, events };
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
