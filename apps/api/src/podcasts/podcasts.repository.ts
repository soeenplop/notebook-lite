import { randomUUID } from 'node:crypto';
import type { TablesInsert } from '@notebook-lite/db';
import {
  ACTIVE_PODCAST_STATUSES,
  type createPodcastInputSchema,
  type LanguageCode,
  languageCodeSchema,
  PODCASTS_BUCKET,
  type PodcastDetail,
  podcastDetailSchema,
  podcastScriptSchema,
  type PodcastSourceOption,
  podcastStorageFolder,
  type PodcastSummary,
  podcastSummarySchema,
} from '@notebook-lite/shared';
import { TRPCError } from '@trpc/server';
import type { z } from 'zod';
import type { Db } from '../supabase/types.js';
import type { JobSender } from '../trpc/context.js';
import { notFound, toTrpcError } from '../trpc/db-errors.js';

/**
 * Data access for podcasts. Every function takes the caller's RLS-scoped client, so Postgres
 * guarantees users only see or change their own rows and Storage objects. Plain functions (no
 * Nest): used directly by the tRPC router.
 */

const SUMMARY_COLUMNS =
  'id, notebook_id, title, topic, mode, target_minutes, language, status, error, duration_seconds, created_at, updated_at';

/** Signed audio URLs stay valid this long (long enough to listen to a 15-minute episode). */
export const SIGNED_URL_SECONDS = 60 * 60;

interface SummaryRow {
  id: string;
  notebook_id: string;
  title: string | null;
  topic: string;
  mode: string;
  target_minutes: number;
  language: string;
  status: string;
  error: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export function toPodcastSummary(row: SummaryRow): PodcastSummary {
  return podcastSummarySchema.parse({
    id: row.id,
    notebookId: row.notebook_id,
    title: row.title,
    topic: row.topic,
    mode: row.mode,
    targetMinutes: row.target_minutes,
    language: row.language,
    status: row.status,
    error: row.error,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** The notebook's language, or NOT_FOUND if the caller has no such notebook. */
export async function getNotebookLanguage(db: Db, notebookId: string): Promise<LanguageCode> {
  const { data, error } = await db
    .from('notebooks')
    .select('language')
    .eq('id', notebookId)
    .maybeSingle();
  if (error) throw toTrpcError(error);
  if (!data) throw notFound('Notebook');
  return languageCodeSchema.parse(data.language);
}

/** Ready sources of a notebook, oldest first (wizard source picker). */
export async function listSourceOptions(
  db: Db,
  notebookId: string,
): Promise<PodcastSourceOption[]> {
  const { data, error } = await db
    .from('sources')
    .select('id, title, kind')
    .eq('notebook_id', notebookId)
    .eq('status', 'ready')
    .order('created_at', { ascending: true });
  if (error) throw toTrpcError(error);
  return data.map((row) => ({ id: row.id, title: row.title, kind: row.kind }));
}

/**
 * Loads the given sources of a notebook and checks that all exist and are ready.
 * Returns them in the requested order.
 */
export async function requireReadySources(
  db: Db,
  notebookId: string,
  sourceIds: readonly string[],
): Promise<{ id: string; title: string }[]> {
  const { data, error } = await db
    .from('sources')
    .select('id, title, status')
    .eq('notebook_id', notebookId)
    .in('id', [...sourceIds]);
  if (error) throw toTrpcError(error);
  const byId = new Map(data.map((row) => [row.id, row]));
  const sources = sourceIds.map((id) => byId.get(id));
  if (sources.some((source) => !source)) throw notFound('Source');
  if (sources.some((source) => source?.status !== 'ready')) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'All selected sources must finish processing first',
    });
  }
  return sources.flatMap((source) => (source ? [{ id: source.id, title: source.title }] : []));
}

export async function listPodcasts(db: Db, notebookId: string): Promise<PodcastSummary[]> {
  const { data, error } = await db
    .from('podcasts')
    .select(SUMMARY_COLUMNS)
    .eq('notebook_id', notebookId)
    .order('created_at', { ascending: false });
  if (error) throw toTrpcError(error);
  return data.map(toPodcastSummary);
}

export async function getPodcast(db: Db, id: string): Promise<PodcastDetail> {
  const { data, error } = await db
    .from('podcasts')
    .select(`${SUMMARY_COLUMNS}, script, storage_path`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw toTrpcError(error);
  if (!data) throw notFound('Podcast');
  const summary = toPodcastSummary(data);

  const links = await db.from('podcast_sources').select('source_id').eq('podcast_id', id);
  if (links.error) throw toTrpcError(links.error);
  const sourceIds = links.data.map((link) => link.source_id);
  let sources: { id: string; title: string }[] = [];
  if (sourceIds.length > 0) {
    const titles = await db.from('sources').select('id, title').in('id', sourceIds);
    if (titles.error) throw toTrpcError(titles.error);
    sources = titles.data.map((row) => ({ id: row.id, title: row.title }));
  }

  const script = podcastScriptSchema.safeParse(data.script);
  const urls =
    summary.status === 'ready' && data.storage_path
      ? await signAudioUrls(db, data.storage_path, summary.title ?? summary.topic)
      : { audioUrl: null, downloadUrl: null };

  return podcastDetailSchema.parse({
    ...summary,
    script: script.success ? script.data : null,
    sources,
    ...urls,
  });
}

/** Short-lived signed URLs for playback and download, created with the caller's session. */
async function signAudioUrls(
  db: Db,
  path: string,
  title: string,
): Promise<{ audioUrl: string; downloadUrl: string }> {
  const bucket = db.storage.from(PODCASTS_BUCKET);
  const [play, download] = await Promise.all([
    bucket.createSignedUrl(path, SIGNED_URL_SECONDS),
    bucket.createSignedUrl(path, SIGNED_URL_SECONDS, { download: downloadFileName(title) }),
  ]);
  if (play.error || download.error) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not create the audio link',
      cause: play.error ?? download.error,
    });
  }
  return { audioUrl: play.data.signedUrl, downloadUrl: download.data.signedUrl };
}

/** A safe file name for the download, e.g. "Solar boom.mp3". */
export function downloadFileName(title: string): string {
  const base = title
    .normalize('NFKC')
    .replaceAll(/[^\p{L}\p{N} ._-]+/gu, '')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || 'podcast'}.mp3`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Creates a podcast (status `queued`; the language is copied from the notebook by a trigger),
 * links its sources and enqueues `generate-podcast`. A user may have at most one podcast in
 * production at a time; a partial unique index enforces this against concurrent calls.
 */
export async function createPodcast(
  db: Db,
  jobs: JobSender,
  userId: string,
  input: z.output<typeof createPodcastInputSchema>,
  podcastsPerDay: number,
): Promise<PodcastSummary> {
  await getNotebookLanguage(db, input.notebookId);
  await requireReadySources(db, input.notebookId, input.sourceIds);

  const active = await db
    .from('podcasts')
    .select('id', { count: 'exact', head: true })
    .in('status', [...ACTIVE_PODCAST_STATUSES]);
  if (active.error) throw toTrpcError(active.error);
  if ((active.count ?? 0) > 0) throw alreadyInProduction();

  const recent = await db
    .from('podcasts')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - DAY_MS).toISOString());
  if (recent.error) throw toTrpcError(recent.error);
  if ((recent.count ?? 0) >= podcastsPerDay) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `You can create up to ${podcastsPerDay} podcasts per day`,
    });
  }

  const id = randomUUID();
  const row: Omit<TablesInsert<'podcasts'>, 'language'> = {
    id,
    notebook_id: input.notebookId,
    topic: input.topic,
    mode: input.mode,
    target_minutes: input.targetMinutes,
  };
  const inserted = await db
    .from('podcasts')
    // `language` is required in the generated type but set by a trigger (users may not write it).
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    .insert(row as TablesInsert<'podcasts'>)
    .select(SUMMARY_COLUMNS)
    .single();
  if (inserted.error) {
    if (inserted.error.code === '23505') throw alreadyInProduction();
    throw toTrpcError(inserted.error);
  }

  try {
    const links = await db.from('podcast_sources').insert(
      input.sourceIds.map((sourceId) => ({
        podcast_id: id,
        source_id: sourceId,
        notebook_id: input.notebookId,
      })),
    );
    if (links.error) throw toTrpcError(links.error);
    await jobs.send(
      'generate-podcast',
      { podcastId: id, notebookId: input.notebookId, userId },
      { singletonKey: id },
    );
  } catch (error) {
    // Roll back so the user is not blocked by a podcast that will never be produced.
    await db.from('podcasts').delete().eq('id', id);
    throw error;
  }
  return toPodcastSummary(inserted.data);
}

function alreadyInProduction(): TRPCError {
  return new TRPCError({
    code: 'TOO_MANY_REQUESTS',
    message: 'A podcast is already being produced. Wait until it is ready, then try again.',
  });
}

/** Deletes a podcast and its audio files (the cached batches and the final MP3). */
export async function deletePodcast(db: Db, id: string): Promise<{ id: string }> {
  const { data, error } = await db
    .from('podcasts')
    .select('id, user_id, notebook_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw toTrpcError(error);
  if (!data) throw notFound('Podcast');

  const bucket = db.storage.from(PODCASTS_BUCKET);
  const folder = podcastStorageFolder(data.user_id, data.notebook_id, data.id);
  const listed = await bucket.list(folder, { limit: 1000 });
  if (listed.error) throw storageError(listed.error);
  if (listed.data.length > 0) {
    const removed = await bucket.remove(listed.data.map((file) => `${folder}/${file.name}`));
    if (removed.error) throw storageError(removed.error);
  }

  const deleted = await db.from('podcasts').delete().eq('id', id).select('id').maybeSingle();
  if (deleted.error) throw toTrpcError(deleted.error);
  if (!deleted.data) throw notFound('Podcast');
  return { id: deleted.data.id };
}

function storageError(cause: unknown): TRPCError {
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Could not delete the podcast audio',
    cause,
  });
}
