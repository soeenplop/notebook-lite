import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AiModels,
  embedQuery,
  generatePodcastScript,
  type PodcastExcerpt,
  toVectorLiteral,
} from '@notebook-lite/ai';
import type { Database } from '@notebook-lite/db';
import {
  type GeneratePodcastJob,
  getLanguage,
  languageCodeSchema,
  PODCASTS_BUCKET,
  type PodcastLength,
  type PodcastScript,
  type PodcastStatus,
  podcastAudioPath,
  podcastBatchPath,
  podcastLengthSchema,
  podcastModeSchema,
  podcastScriptSchema,
  podcastStorageFolder,
} from '@notebook-lite/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type DialogueSynthesizer, ElevenLabsError } from './elevenlabs.client.js';
import type { AudioTools } from './audio.js';
import { buildDialogueBatches, type VoiceMap } from './tts-batches.js';

/** Service-role client: bypasses RLS, so every query below filters by `user_id`. */
export type ServiceDb = SupabaseClient<Database>;

export interface PipelineLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string, stack?: string): void;
}

export interface PodcastPipelineDeps {
  db: ServiceDb;
  models: AiModels;
  /** null when ElevenLabs is not configured; `configError` then says what is missing. */
  tts: DialogueSynthesizer | null;
  configError: string | null;
  voices: VoiceMap;
  audio: AudioTools;
  logger: PipelineLogger;
  /** pg-boss retries after the first attempt; the last attempt marks the podcast failed. */
  retryLimit: number;
  tmpRoot?: string;
}

export interface JobRun {
  /** 0 on the first attempt. */
  retryCount: number;
  signal: AbortSignal;
}

/** Retrieval per length: number of chunks and their token budget (~20–40k for long episodes). */
export const RETRIEVAL: Record<PodcastLength, { chunks: number; tokens: number }> = {
  2: { chunks: 16, tokens: 12_000 },
  6: { chunks: 30, tokens: 24_000 },
  15: { chunks: 50, tokens: 40_000 },
};

export const MESSAGES = {
  notConfigured: 'Podcast audio is not configured yet. Please try again later.',
  noContent: 'The selected sources contain no text to build a podcast from.',
  ttsRejected: 'The speech service could not create the audio. Please try again later.',
  generic: 'Podcast generation failed. Please try again.',
} as const;

/** A failure with a message for the user. Not retryable unless stated. */
export class PodcastJobError extends Error {
  constructor(
    readonly userMessage: string,
    readonly retryable = false,
    options?: { cause?: unknown },
  ) {
    super(
      options?.cause instanceof Error ? `${userMessage} (${options.cause.message})` : userMessage,
      options,
    );
    this.name = 'PodcastJobError';
  }
}

/** The podcast or its notebook was deleted while the job ran: stop quietly. */
class PodcastGoneError extends Error {}

interface PodcastRow {
  id: string;
  user_id: string;
  notebook_id: string;
  language: string;
  topic: string;
  mode: string;
  target_minutes: number;
  status: string;
  script: unknown;
}

/**
 * The `generate-podcast` job: script (LLM, grounded in retrieved chunks) → TTS batches
 * (ElevenLabs text-to-dialogue, each cached in Storage) → ffmpeg concat → Storage upload.
 * The script and every finished batch are persisted, so a retried job resumes where the
 * previous attempt stopped.
 */
export class PodcastPipeline {
  constructor(private readonly deps: PodcastPipelineDeps) {}

  async run(job: GeneratePodcastJob, run: JobRun): Promise<void> {
    const tag = `podcast ${job.podcastId}`;
    const podcast = await this.loadPodcast(job);
    if (!podcast) {
      this.deps.logger.log(`${tag}: podcast no longer exists, skipping`);
      return;
    }
    if (podcast.status === 'ready' || podcast.status === 'failed') {
      this.deps.logger.log(`${tag}: already ${podcast.status}, skipping`);
      return;
    }

    try {
      await this.produce(job, podcast, run.signal);
      this.deps.logger.log(`${tag}: ready`);
    } catch (error) {
      if (error instanceof PodcastGoneError) {
        this.deps.logger.log(`${tag}: deleted while in production, cleaning up`);
        await this.removeFolder(job);
        return;
      }
      const retryable = isRetryable(error);
      const final = !retryable || run.retryCount >= this.deps.retryLimit;
      const description = error instanceof Error ? error.message : String(error);
      this.deps.logger.error(
        `${tag}: attempt ${run.retryCount + 1} failed${final ? '' : ', will retry'}: ${description}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (!final) throw error;
      await this.update(job, { status: 'failed', error: messageForUser(error) }).catch(
        (updateError: unknown) => {
          if (!(updateError instanceof PodcastGoneError)) throw updateError;
        },
      );
    }
  }

  private async produce(job: GeneratePodcastJob, podcast: PodcastRow, signal: AbortSignal) {
    const { deps } = this;
    const language = languageCodeSchema.parse(podcast.language);
    const mode = podcastModeSchema.parse(podcast.mode);
    const targetMinutes = podcastLengthSchema.parse(podcast.target_minutes);

    await this.requireNotebook(job);
    // Check the TTS setup before spending tokens on a script.
    if (deps.configError || !deps.tts) {
      throw new PodcastJobError(MESSAGES.notConfigured, false, {
        cause: new Error(`ElevenLabs: ${deps.configError ?? 'not configured'}`),
      });
    }
    if (mode === 'dialogue' && !deps.voices.B) {
      throw new PodcastJobError(MESSAGES.notConfigured, false, {
        cause: new Error('ElevenLabs: missing ELEVENLABS_VOICE_B for dialogues'),
      });
    }

    let script = parseScript(podcast.script);
    if (!script) {
      await this.update(job, { status: 'scripting', error: null });
      const excerpts = await this.retrieve(job, podcast.topic, targetMinutes, signal);
      script = await generatePodcastScript(deps.models.chat, {
        language,
        mode,
        targetMinutes,
        topic: podcast.topic,
        excerpts,
        abortSignal: signal,
      });
      await this.update(job, { script, title: script.title });
    }

    await this.update(job, { status: 'synthesizing', error: null });
    const batches = buildDialogueBatches(script.segments, deps.voices);
    const bucket = deps.db.storage.from(PODCASTS_BUCKET);
    const folder = podcastStorageFolder(job.userId, job.notebookId, job.podcastId);
    const listed = await bucket.list(folder, { limit: 1000 });
    if (listed.error) throw listed.error;
    const cached = new Set(listed.data.map((file) => file.name));

    const dir = await mkdtemp(path.join(deps.tmpRoot ?? tmpdir(), 'podcast-'));
    try {
      const files: string[] = [];
      for (const [n, inputs] of batches.entries()) {
        const storagePath = podcastBatchPath(job.userId, job.notebookId, job.podcastId, n);
        const file = path.join(dir, `batch-${n}.mp3`);
        // Sequential: one TTS request at a time keeps within ElevenLabs concurrency limits.
        if (cached.has(`batch-${n}.mp3`)) {
          // oxlint-disable-next-line no-await-in-loop
          const downloaded = await bucket.download(storagePath);
          if (downloaded.error) throw downloaded.error;
          // oxlint-disable-next-line no-await-in-loop
          await writeFile(file, Buffer.from(await downloaded.data.arrayBuffer()));
        } else {
          // oxlint-disable-next-line no-await-in-loop
          const audio = await deps.tts.synthesize({
            inputs,
            languageCode: getLanguage(language).elevenLabsCode,
            signal,
          });
          // oxlint-disable-next-line no-await-in-loop
          await this.upload(storagePath, audio);
          // oxlint-disable-next-line no-await-in-loop
          await writeFile(file, audio);
        }
        files.push(file);
      }

      const output = path.join(dir, 'podcast.mp3');
      await deps.audio.concatMp3(files, output, signal);
      const durationSeconds = await deps.audio.durationSeconds(output, signal);
      const audioPath = podcastAudioPath(job.userId, job.notebookId, job.podcastId);
      await this.upload(audioPath, await readFile(output));
      await this.update(job, {
        status: 'ready',
        error: null,
        storage_path: audioPath,
        duration_seconds: durationSeconds,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    // The batches are only a resume cache; the episode is complete now.
    const batchPaths = batches.map((_, n) =>
      podcastBatchPath(job.userId, job.notebookId, job.podcastId, n),
    );
    const removed = await bucket.remove(batchPaths);
    if (removed.error) {
      deps.logger.warn(`podcast ${job.podcastId}: could not remove cached batches`);
    }
  }

  /** Chunks of the podcast's sources relevant to its topic, within the length's budget. */
  private async retrieve(
    job: GeneratePodcastJob,
    topic: string,
    minutes: PodcastLength,
    signal: AbortSignal,
  ): Promise<PodcastExcerpt[]> {
    const { db, models } = this.deps;
    const links = await db
      .from('podcast_sources')
      .select('source_id')
      .eq('podcast_id', job.podcastId)
      .eq('user_id', job.userId);
    if (links.error) throw links.error;
    const sources = links.data.length
      ? await db
          .from('sources')
          .select('id, title')
          .eq('user_id', job.userId)
          .eq('notebook_id', job.notebookId)
          .eq('status', 'ready')
          .in(
            'id',
            links.data.map((link) => link.source_id),
          )
      : { data: [], error: null };
    if (sources.error) throw sources.error;
    if (sources.data.length === 0) throw new PodcastJobError(MESSAGES.noContent);

    const { chunks, tokens } = RETRIEVAL[minutes];
    const embedding = await embedQuery(models.embedding, topic, { abortSignal: signal });
    const matched = await db.rpc('match_chunks', {
      p_notebook_id: job.notebookId,
      p_query_embedding: toVectorLiteral(embedding),
      p_query_text: topic,
      p_source_ids: sources.data.map((source) => source.id),
      p_match_count: chunks,
      p_candidate_count: Math.max(40, chunks * 2),
      // Service role: RLS does not apply, so scope the function to the owner explicitly.
      p_user_id: job.userId,
    });
    if (matched.error) throw matched.error;

    // Keep the best chunks within the budget, then restore document order for coherence.
    const selected: typeof matched.data = [];
    let used = 0;
    for (const chunk of matched.data) {
      if (selected.length > 0 && used + chunk.token_count > tokens) break;
      used += chunk.token_count;
      selected.push(chunk);
    }
    if (selected.length === 0) throw new PodcastJobError(MESSAGES.noContent);
    const order = new Map(sources.data.map((source, index) => [source.id, index]));
    const titles = new Map(sources.data.map((source) => [source.id, source.title]));
    return selected
      .toSorted(
        (a, b) =>
          (order.get(a.source_id) ?? 0) - (order.get(b.source_id) ?? 0) || a.ordinal - b.ordinal,
      )
      .map((chunk) => ({
        sourceTitle: titles.get(chunk.source_id) ?? 'Source',
        content: chunk.content,
      }));
  }

  private async loadPodcast(job: GeneratePodcastJob): Promise<PodcastRow | null> {
    const { data, error } = await this.deps.db
      .from('podcasts')
      .select('id, user_id, notebook_id, language, topic, mode, target_minutes, status, script')
      .eq('id', job.podcastId)
      .eq('user_id', job.userId)
      .eq('notebook_id', job.notebookId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  private async requireNotebook(job: GeneratePodcastJob): Promise<void> {
    const { data, error } = await this.deps.db
      .from('notebooks')
      .select('id')
      .eq('id', job.notebookId)
      .eq('user_id', job.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new PodcastGoneError();
  }

  /** Updates the podcast row; throws PodcastGoneError if it no longer exists. */
  private async update(
    job: GeneratePodcastJob,
    patch: {
      status?: PodcastStatus;
      error?: string | null;
      script?: PodcastScript;
      title?: string;
      storage_path?: string;
      duration_seconds?: number;
    },
  ): Promise<void> {
    const { data, error } = await this.deps.db
      .from('podcasts')
      .update(patch)
      .eq('id', job.podcastId)
      .eq('user_id', job.userId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new PodcastGoneError();
  }

  private async upload(storagePath: string, audio: Buffer): Promise<void> {
    const { error } = await this.deps.db.storage
      .from(PODCASTS_BUCKET)
      .upload(storagePath, audio, { contentType: 'audio/mpeg', upsert: true });
    if (error) throw error;
  }

  /** Best effort: removes everything stored for a deleted podcast. */
  private async removeFolder(job: GeneratePodcastJob): Promise<void> {
    const bucket = this.deps.db.storage.from(PODCASTS_BUCKET);
    const folder = podcastStorageFolder(job.userId, job.notebookId, job.podcastId);
    const listed = await bucket.list(folder, { limit: 1000 });
    if (listed.error || listed.data.length === 0) return;
    await bucket.remove(listed.data.map((file) => `${folder}/${file.name}`));
  }
}

function parseScript(value: unknown): PodcastScript | null {
  const parsed = podcastScriptSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof PodcastJobError) return error.retryable;
  if (error instanceof ElevenLabsError) return error.retryable;
  // Model, database, Storage and ffmpeg failures are usually transient.
  return true;
}

function messageForUser(error: unknown): string {
  if (error instanceof PodcastJobError) return error.userMessage;
  if (error instanceof ElevenLabsError && !error.retryable) return MESSAGES.ttsRejected;
  return MESSAGES.generic;
}
