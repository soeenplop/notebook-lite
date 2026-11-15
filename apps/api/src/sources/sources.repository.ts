import {
  type createSourceFromUrlInputSchema,
  type createSourceInputSchema,
  SOURCE_MIME_TYPES,
  SOURCE_TITLE_MAX_LENGTH,
  type Source,
  sourceSchema,
  sourceStoragePath,
  STORAGE_BUCKETS,
} from '@notebook-lite/shared';
import { TRPCError } from '@trpc/server';
import type { z } from 'zod';
import { removeStorageFolder } from '../storage/storage-cleanup.js';
import type { Db } from '../supabase/types.js';
import type { JobSender } from '../trpc/context.js';
import { notFound, toTrpcError } from '../trpc/db-errors.js';

/**
 * Data access for sources. Every function takes the caller's RLS-scoped client and filters by
 * notebook, so users only ever see or change sources of their own notebooks. Plain functions
 * (no Nest): used directly by the tRPC router.
 */

const COLUMNS =
  'id, notebook_id, kind, title, original_url, mime_type, size_bytes, status, error, page_count, token_count, created_at, updated_at';

interface SourceDbRow {
  id: string;
  notebook_id: string;
  kind: string;
  title: string;
  original_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: string;
  error: string | null;
  page_count: number | null;
  token_count: number | null;
  created_at: string;
  updated_at: string;
}

export function toSource(row: SourceDbRow): Source {
  return sourceSchema.parse({
    id: row.id,
    notebookId: row.notebook_id,
    kind: row.kind,
    title: row.title,
    originalUrl: row.original_url,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status,
    error: row.error,
    pageCount: row.page_count,
    tokenCount: row.token_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** A notebook's sources, newest first. */
export async function listSources(db: Db, notebookId: string): Promise<Source[]> {
  const { data, error } = await db
    .from('sources')
    .select(COLUMNS)
    .eq('notebook_id', notebookId)
    .order('created_at', { ascending: false });
  if (error) throw toTrpcError(error);
  return data.map(toSource);
}

export async function getSource(db: Db, notebookId: string, id: string): Promise<Source> {
  const { data, error } = await db
    .from('sources')
    .select(COLUMNS)
    .eq('notebook_id', notebookId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw toTrpcError(error);
  if (!data) throw notFound('Source');
  return toSource(data);
}

/**
 * Registers a file the web app uploaded to `sources/{userId}/{notebookId}/{id}/{fileName}` and
 * queues it for ingestion. The path is built here from the caller's id, never taken from input.
 */
export async function createSource(
  db: Db,
  jobs: JobSender,
  userId: string,
  input: z.output<typeof createSourceInputSchema>,
): Promise<Source> {
  const { data, error } = await db
    .from('sources')
    .insert({
      id: input.id,
      notebook_id: input.notebookId,
      kind: input.kind,
      title: input.title,
      storage_path: sourceStoragePath(userId, input.notebookId, input.id, input.fileName),
      mime_type: SOURCE_MIME_TYPES[input.kind],
      size_bytes: input.sizeBytes,
    })
    .select(COLUMNS)
    .single();
  if (error) throw toTrpcError(error);
  const source = toSource(data);
  await enqueueIngestion(db, jobs, userId, source);
  return source;
}

/** Adds a web page; the worker fetches it (SSRF-guarded) and stores a snapshot. */
export async function createSourceFromUrl(
  db: Db,
  jobs: JobSender,
  userId: string,
  input: z.output<typeof createSourceFromUrlInputSchema>,
): Promise<Source> {
  const { data, error } = await db
    .from('sources')
    .insert({
      notebook_id: input.notebookId,
      kind: 'url',
      // Placeholder until the worker reads the page title.
      title: titleFromUrl(input.url),
      original_url: input.url,
    })
    .select(COLUMNS)
    .single();
  if (error) throw toTrpcError(error);
  const source = toSource(data);
  await enqueueIngestion(db, jobs, userId, source);
  return source;
}

/**
 * Deletes a source: first its Storage objects (upload or URL snapshot), then the row. Chunks
 * cascade; chat citations keep their snapshot.
 */
export async function deleteSource(
  db: Db,
  userId: string,
  notebookId: string,
  id: string,
): Promise<{ id: string }> {
  const { data: existing, error: lookupError } = await db
    .from('sources')
    .select('id')
    .eq('notebook_id', notebookId)
    .eq('id', id)
    .maybeSingle();
  if (lookupError) throw toTrpcError(lookupError);
  if (!existing) throw notFound('Source');

  await removeStorageFolder(db, STORAGE_BUCKETS.sources, `${userId}/${notebookId}/${id}`);

  const { data, error } = await db
    .from('sources')
    .delete()
    .eq('notebook_id', notebookId)
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw toTrpcError(error);
  if (!data) throw notFound('Source');
  return { id: data.id };
}

export function titleFromUrl(url: string): string {
  const parsed = new URL(url);
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${parsed.hostname}${path}`.slice(0, SOURCE_TITLE_MAX_LENGTH);
}

/**
 * Queues ingestion. If the queue is unavailable the row is removed again, so no source is left
 * waiting forever; the caller sees an error and can retry.
 */
async function enqueueIngestion(
  db: Db,
  jobs: JobSender,
  userId: string,
  source: Source,
): Promise<void> {
  try {
    await jobs.send(
      'ingest-source',
      { sourceId: source.id, notebookId: source.notebookId, userId },
      { singletonKey: source.id },
    );
  } catch (cause) {
    await db.from('sources').delete().eq('id', source.id);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not queue the source for processing',
      cause,
    });
  }
}
