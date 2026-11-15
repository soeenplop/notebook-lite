import {
  type createNotebookInputSchema,
  type NotebookSummary,
  notebookStoragePrefix,
  notebookSummarySchema,
  STORAGE_BUCKETS,
  type updateNotebookInputSchema,
} from '@notebook-lite/shared';
import type { z } from 'zod';
import { removeStorageFolder } from '../storage/storage-cleanup.js';
import type { Db } from '../supabase/types.js';
import { notFound, toTrpcError } from '../trpc/db-errors.js';

/**
 * Data access for notebooks. Every function takes the caller's RLS-scoped client, so Postgres
 * guarantees users only ever see or change their own notebooks. Plain functions (no Nest):
 * used directly by the tRPC router.
 */

const SUMMARY_COLUMNS =
  'id, name, description, language, created_at, updated_at, sources(count), chats(count), podcasts(count)';

interface SummaryRow {
  id: string;
  name: string;
  description: string | null;
  language: string;
  created_at: string;
  updated_at: string;
  sources: { count: number }[];
  chats: { count: number }[];
  podcasts: { count: number }[];
}

export function toNotebookSummary(row: SummaryRow): NotebookSummary {
  return notebookSummarySchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    language: row.language,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    counts: {
      sources: row.sources[0]?.count ?? 0,
      chats: row.chats[0]?.count ?? 0,
      podcasts: row.podcasts[0]?.count ?? 0,
    },
  });
}

export async function listNotebooks(db: Db): Promise<NotebookSummary[]> {
  const { data, error } = await db
    .from('notebooks')
    .select(SUMMARY_COLUMNS)
    .order('updated_at', { ascending: false });
  if (error) throw toTrpcError(error);
  return data.map(toNotebookSummary);
}

export async function getNotebook(db: Db, id: string): Promise<NotebookSummary> {
  const { data, error } = await db
    .from('notebooks')
    .select(SUMMARY_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw toTrpcError(error);
  if (!data) throw notFound('Notebook');
  return toNotebookSummary(data);
}

export async function createNotebook(
  db: Db,
  input: z.output<typeof createNotebookInputSchema>,
): Promise<NotebookSummary> {
  const { data, error } = await db
    .from('notebooks')
    .insert({ name: input.name, description: input.description, language: input.language })
    .select(SUMMARY_COLUMNS)
    .single();
  if (error) throw toTrpcError(error);
  return toNotebookSummary(data);
}

export async function updateNotebook(
  db: Db,
  { id, ...patch }: z.output<typeof updateNotebookInputSchema>,
): Promise<NotebookSummary> {
  const { data, error } = await db
    .from('notebooks')
    .update(patch)
    .eq('id', id)
    .select(SUMMARY_COLUMNS)
    .maybeSingle();
  if (error) throw toTrpcError(error);
  if (!data) throw notFound('Notebook');
  return toNotebookSummary(data);
}

/**
 * Deletes a notebook:
 *  1. its Storage folders `sources/{uid}/{id}/` and `podcasts/{uid}/{id}/` (user client, RLS),
 *  2. the row; sources, chunks, chats, messages and podcasts cascade in the database.
 * Queued jobs are not cancelled: the worker re-checks that its notebook and entity still exist
 * and aborts quietly otherwise.
 */
export async function deleteNotebook(db: Db, userId: string, id: string): Promise<{ id: string }> {
  const { data: existing, error: lookupError } = await db
    .from('notebooks')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (lookupError) throw toTrpcError(lookupError);
  if (!existing) throw notFound('Notebook');

  const prefix = notebookStoragePrefix(userId, id);
  await removeStorageFolder(db, STORAGE_BUCKETS.sources, prefix);
  await removeStorageFolder(db, STORAGE_BUCKETS.podcasts, prefix);

  const { data, error } = await db
    .from('notebooks')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw toTrpcError(error);
  if (!data) throw notFound('Notebook');
  return { id: data.id };
}
