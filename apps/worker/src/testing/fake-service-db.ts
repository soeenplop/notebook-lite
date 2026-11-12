import type { ServiceDb } from '../podcasts/podcast-pipeline.js';

type Row = Record<string, unknown>;

export interface FakeState {
  tables: Record<string, Row[]>;
  /** Rows returned by `rpc('match_chunks', …)`. */
  matchChunks: Row[];
  /** Storage objects of the `podcasts` bucket by path. */
  storage: Map<string, Buffer>;
  /** Every call, for assertions: table/rpc/storage name, filters and payloads. */
  log: { target: string; op: string; filters: [string, string, unknown][]; payload?: unknown }[];
  /** Makes the next Storage upload fail once (simulates a transient error). */
  failNextUpload?: boolean;
}

/**
 * A tiny in-memory stand-in for the service-role Supabase client, enough for the podcast
 * pipeline: select/update with eq/in filters, `match_chunks` and the Storage calls it uses.
 */
export function fakeServiceDb(initial: Partial<FakeState> = {}): {
  db: ServiceDb;
  state: FakeState;
} {
  const state: FakeState = {
    tables: {},
    matchChunks: [],
    storage: new Map(),
    log: [],
    ...initial,
  };

  function query(table: string) {
    const filters: [string, string, unknown][] = [];
    let op = 'select';
    let payload: unknown;
    let single = false;

    const matches = (row: Row) =>
      filters.every(([kind, column, value]) =>
        kind === 'eq' ? row[column] === value : Array.isArray(value) && value.includes(row[column]),
      );

    const execute = () => {
      state.log.push({ target: table, op, filters: [...filters], payload });
      const rows = (state.tables[table] ??= []);
      let result: Row[];
      if (op === 'update') {
        result = rows.filter(matches);
        for (const row of result) Object.assign(row, payload);
      } else {
        result = rows.filter(matches);
      }
      return { data: single ? (result[0] ?? null) : result, error: null };
    };

    // A thenable query builder, like supabase-js's.
    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (patch: unknown) => {
        op = 'update';
        payload = patch;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push(['eq', column, value]);
        return builder;
      },
      in: (column: string, values: unknown) => {
        filters.push(['in', column, values]);
        return builder;
      },
      maybeSingle: () => {
        single = true;
        return builder;
      },
      // oxlint-disable-next-line unicorn/no-thenable
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve().then(execute).then(resolve, reject),
    };
    return builder;
  }

  const bucket = (name: string) => ({
    list: (folder: string) => {
      state.log.push({ target: `storage:${name}`, op: 'list', filters: [], payload: folder });
      const prefix = `${folder}/`;
      const data = [...state.storage.keys()]
        .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .map((key) => ({ name: key.slice(prefix.length) }));
      return Promise.resolve({ data, error: null });
    },
    download: (path: string) => {
      state.log.push({ target: `storage:${name}`, op: 'download', filters: [], payload: path });
      const file = state.storage.get(path);
      return Promise.resolve(
        file
          ? { data: new Blob([new Uint8Array(file)]), error: null }
          : { data: null, error: new Error('not found') },
      );
    },
    upload: (path: string, body: Buffer, options: unknown) => {
      state.log.push({
        target: `storage:${name}`,
        op: 'upload',
        filters: [],
        payload: { path, options },
      });
      if (state.failNextUpload) {
        state.failNextUpload = false;
        return Promise.resolve({ data: null, error: new Error('storage unavailable') });
      }
      state.storage.set(path, Buffer.from(body));
      return Promise.resolve({ data: { path }, error: null });
    },
    remove: (paths: string[]) => {
      state.log.push({ target: `storage:${name}`, op: 'remove', filters: [], payload: paths });
      for (const path of paths) state.storage.delete(path);
      return Promise.resolve({ data: [], error: null });
    },
  });

  const client = {
    from: query,
    rpc: (fn: string, args: unknown) => {
      state.log.push({ target: `rpc:${fn}`, op: 'rpc', filters: [], payload: args });
      return Promise.resolve({ data: state.matchChunks, error: null });
    },
    storage: { from: bucket },
  };
  return { db: client as unknown as ServiceDb, state };
}
