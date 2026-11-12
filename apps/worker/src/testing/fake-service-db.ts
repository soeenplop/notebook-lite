import type { ServiceDb } from '../supabase/service-db.js';

type Row = Record<string, unknown>;

interface DbError {
  message: string;
  code?: string;
}

/**
 * In-memory stand-in for the service-role Supabase client, enough for the ingestion job:
 * `from(table)` with select/insert/update/delete, `eq` filters, `maybeSingle`, and Storage
 * upload/download/remove. Every table query must filter by `user_id` (inserts must set it):
 * otherwise it throws, which enforces the service-role rule from AGENTS.md in tests.
 */
export class FakeServiceDb {
  readonly tables: Record<string, Row[]> = { sources: [], source_chunks: [] };
  readonly objects = new Map<string, Uint8Array>();
  readonly uploads: { path: string; contentType: string | undefined }[] = [];
  /** Called before each table query executes; may mutate state or return an error. */
  beforeQuery: ((table: string, action: string) => DbError | undefined) | undefined;
  /** Error returned by the next Storage download. */
  downloadError: DbError | null = null;

  get client(): ServiceDb {
    return this as unknown as ServiceDb;
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  readonly storage = {
    from: (bucket: string) => ({
      upload: (path: string, body: Uint8Array, options?: { contentType?: string }) => {
        this.objects.set(`${bucket}/${path}`, body);
        this.uploads.push({ path: `${bucket}/${path}`, contentType: options?.contentType });
        return Promise.resolve({ data: { path }, error: null });
      },
      download: (path: string) => {
        const error = this.downloadError;
        if (error) return Promise.resolve({ data: null, error });
        const body = this.objects.get(`${bucket}/${path}`);
        if (!body) return Promise.resolve({ data: null, error: { message: 'Object not found' } });
        return Promise.resolve({ data: new Blob([new Uint8Array(body)]), error: null });
      },
      remove: (paths: string[]) => {
        for (const path of paths) this.objects.delete(`${bucket}/${path}`);
        return Promise.resolve({ data: [], error: null });
      },
    }),
  };
}

class FakeQuery implements PromiseLike<{ data: unknown; error: DbError | null }> {
  private action: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: Row | Row[] | undefined;
  private readonly filters: [string, unknown][] = [];
  private single = false;

  constructor(
    private readonly db: FakeServiceDb,
    private readonly table: string,
  ) {}

  select(): this {
    return this;
  }

  insert(rows: Row | Row[]): this {
    this.action = 'insert';
    this.payload = rows;
    return this;
  }

  update(patch: Row): this {
    this.action = 'update';
    this.payload = patch;
    return this;
  }

  delete(): this {
    this.action = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  maybeSingle(): this {
    this.single = true;
    return this;
  }

  // Intentionally thenable, like supabase-js query builders.
  // oxlint-disable-next-line unicorn/no-thenable
  then<R1 = { data: unknown; error: DbError | null }, R2 = never>(
    onFulfilled?:
      ((value: { data: unknown; error: DbError | null }) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onFulfilled, onRejected);
  }

  private execute(): { data: unknown; error: DbError | null } {
    const injected = this.db.beforeQuery?.(this.table, this.action);
    if (injected) return { data: null, error: injected };
    const rows = (this.db.tables[this.table] ??= []);

    if (this.action === 'insert') {
      const inserted = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
      for (const row of inserted) {
        if (typeof row['user_id'] !== 'string') {
          throw new Error(`insert into ${this.table} without user_id`);
        }
        if (this.table === 'source_chunks' && !this.sourceExists(row)) {
          return { data: null, error: { code: '23503', message: 'foreign key violation' } };
        }
      }
      rows.push(...inserted.map((row) => structuredClone(row)));
      return { data: null, error: null };
    }

    if (!this.filters.some(([column]) => column === 'user_id')) {
      throw new Error(`${this.action} on ${this.table} without a user_id filter`);
    }
    const matches = rows.filter((row) =>
      this.filters.every(([column, value]) => row[column] === value),
    );

    if (this.action === 'update') {
      for (const row of matches) Object.assign(row, this.payload);
      return { data: matches.map((row) => ({ id: row['id'] })), error: null };
    }
    if (this.action === 'delete') {
      this.db.tables[this.table] = rows.filter((row) => !matches.includes(row));
      return { data: null, error: null };
    }
    if (this.single) return { data: matches[0] ? { ...matches[0] } : null, error: null };
    return { data: matches.map((row) => structuredClone(row)), error: null };
  }

  private sourceExists(chunk: Row): boolean {
    return (this.db.tables['sources'] ?? []).some(
      (source) =>
        source['id'] === chunk['source_id'] &&
        source['notebook_id'] === chunk['notebook_id'] &&
        source['user_id'] === chunk['user_id'],
    );
  }
}
