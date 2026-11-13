import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AiModels,
  chunkDocument,
  chunkEmbeddingText,
  embedTexts,
  type TextChunk,
  toVectorLiteral,
} from '@notebook-lite/ai';
import type { TablesInsert, TablesUpdate } from '@notebook-lite/db';
import { type JobContext, QUEUE_SETTINGS } from '@notebook-lite/queue';
import {
  fileSourceKindSchema,
  type IngestSourceJob,
  SOURCE_MAX_BYTES,
  SOURCE_MIME_TYPES,
  SOURCE_TITLE_MAX_LENGTH,
  STORAGE_BUCKETS,
} from '@notebook-lite/shared';
import { AI_MODELS } from '../ai/ai-models.js';
import { SERVICE_DB, type ServiceDb } from '../supabase/service-db.js';
import { IngestError, SourceGoneError } from './errors.js';
import { type Extraction, extractFile } from './extractors.js';
import { extractHtml } from './html.js';
import { UrlFetcher } from './url-fetcher.js';

/** Rows per insert request (3072-dim vectors make rows large). */
const CHUNK_INSERT_BATCH = 100;
/** Upper bound per source (≈ 4M tokens); protects the embedding budget. */
export const MAX_CHUNKS_PER_SOURCE = 5000;
export const SNAPSHOT_FILE_NAME = 'snapshot.md';
const RETRY_LIMIT = QUEUE_SETTINGS['ingest-source'].retryLimit ?? 0;
export const GENERIC_FAILURE = 'Processing failed. Please delete the source and add it again.';

interface SourceRecord {
  id: string;
  kind: string;
  title: string;
  storage_path: string | null;
  original_url: string | null;
  status: string;
}

interface Prepared {
  extraction: Extraction;
  /** Extra columns for URL sources (where the snapshot was stored). */
  snapshot: Pick<TablesUpdate<'sources'>, 'storage_path' | 'mime_type' | 'size_bytes'> | null;
}

/**
 * The `ingest-source` job: extract → chunk → embed → store chunks → mark ready.
 *
 * Runs with the service role, so every query filters by the job's `user_id` (plus notebook and
 * source ids). The source row is re-checked between steps; if it (or its notebook, which
 * cascades to it) was deleted, the job stops quietly. Chunks of earlier attempts are replaced,
 * so retries are idempotent. Permanent problems become a user-readable `error` on the source;
 * transient ones are retried by pg-boss and only reported after the last attempt.
 */
@Injectable()
export class IngestSourceService {
  private readonly logger = new Logger('IngestSource');

  constructor(
    @Inject(SERVICE_DB) private readonly db: ServiceDb,
    @Inject(AI_MODELS) private readonly models: AiModels,
    @Inject(UrlFetcher) private readonly fetcher: UrlFetcher,
  ) {}

  async run(job: IngestSourceJob, context: JobContext): Promise<void> {
    const tag = `job ${context.id} source ${job.sourceId}`;
    const source = await this.loadSource(job);
    if (!source) {
      this.logger.log(`${tag}: source no longer exists, skipping`);
      return;
    }
    if (source.status === 'ready') {
      this.logger.log(`${tag}: already ingested, skipping`);
      return;
    }

    try {
      await this.updateSource(job, { status: 'processing', error: null });
      const { extraction, snapshot } = await this.prepare(job, source, context.signal);

      const chunks = chunkDocument(extraction.document);
      if (chunks.length === 0) throw new IngestError('The source contains no text.');
      if (chunks.length > MAX_CHUNKS_PER_SOURCE) {
        throw new IngestError('The source is too long to process.');
      }

      const title = extraction.title?.trim().slice(0, SOURCE_TITLE_MAX_LENGTH).trim();

      await this.assertExists(job);
      const { embeddings } = await embedTexts(
        this.models.embedding,
        chunks.map((chunk) => chunkEmbeddingText(chunk, title || source.title)),
        { abortSignal: context.signal },
      );

      await this.assertExists(job);
      await this.replaceChunks(job, chunks, embeddings);

      await this.updateSource(job, {
        status: 'ready',
        error: null,
        page_count: extraction.pageCount,
        token_count: chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
        ...(title ? { title } : {}),
        ...snapshot,
      });
      this.logger.log(`${tag}: ready (${chunks.length} chunks)`);
    } catch (error) {
      await this.handleFailure(job, context, tag, error);
    }
  }

  /** The source row, scoped by user and notebook. Its existence implies the notebook's. */
  private async loadSource(job: IngestSourceJob): Promise<SourceRecord | null> {
    const { data, error } = await this.db
      .from('sources')
      .select('id, kind, title, storage_path, original_url, status')
      .eq('id', job.sourceId)
      .eq('notebook_id', job.notebookId)
      .eq('user_id', job.userId)
      .maybeSingle();
    if (error) throw new Error(`loading source failed: ${error.message}`);
    return data;
  }

  private async assertExists(job: IngestSourceJob): Promise<void> {
    if (!(await this.loadSource(job))) throw new SourceGoneError('source deleted');
  }

  /** Updates the source; throws SourceGoneError if it no longer exists. */
  private async updateSource(job: IngestSourceJob, patch: TablesUpdate<'sources'>): Promise<void> {
    const { data, error } = await this.db
      .from('sources')
      .update(patch)
      .eq('id', job.sourceId)
      .eq('notebook_id', job.notebookId)
      .eq('user_id', job.userId)
      .select('id');
    if (error) throw new Error(`updating source failed: ${error.message}`);
    if (data.length === 0) throw new SourceGoneError('source deleted');
  }

  /** Extracts the source's text: download the upload, or fetch the page and store a snapshot. */
  private async prepare(
    job: IngestSourceJob,
    source: SourceRecord,
    signal: AbortSignal,
  ): Promise<Prepared> {
    const folder = `${job.userId}/${job.notebookId}/${job.sourceId}`;

    if (source.kind === 'url') {
      if (!source.original_url) throw new IngestError('The source has no URL.');
      const page = await this.fetcher.fetchPage(source.original_url, signal);
      const extraction = extractHtml(page.html, page.url);
      const markdown = extraction.document.segments.map((segment) => segment.text).join('\n\n');
      const bytes = new TextEncoder().encode(markdown);
      const path = `${folder}/${SNAPSHOT_FILE_NAME}`;
      const { error } = await this.db.storage
        .from(STORAGE_BUCKETS.sources)
        .upload(path, bytes, { contentType: SOURCE_MIME_TYPES.md, upsert: true });
      if (error) throw new Error(`storing the page snapshot failed: ${error.message}`);
      return {
        extraction,
        snapshot: { storage_path: path, mime_type: SOURCE_MIME_TYPES.md, size_bytes: bytes.length },
      };
    }

    const kind = fileSourceKindSchema.safeParse(source.kind);
    if (!kind.success) throw new IngestError('This file type is not supported.');
    // Only objects inside the source's own folder are ever read.
    if (!source.storage_path?.startsWith(`${folder}/`)) {
      throw new IngestError('The uploaded file is missing. Please upload it again.');
    }
    const { data: blob, error } = await this.db.storage
      .from(STORAGE_BUCKETS.sources)
      .download(source.storage_path);
    if (error) {
      if (/not found/i.test(error.message)) {
        throw new IngestError('The uploaded file is missing. Please upload it again.');
      }
      throw new Error(`downloading the file failed: ${error.message}`);
    }
    if (blob.size > SOURCE_MAX_BYTES) throw new IngestError('The file is larger than 25 MB.');
    const extraction = await extractFile(kind.data, new Uint8Array(await blob.arrayBuffer()));
    return { extraction, snapshot: null };
  }

  /** Replaces all chunks of the source (earlier attempts included). */
  private async replaceChunks(
    job: IngestSourceJob,
    chunks: TextChunk[],
    embeddings: number[][],
  ): Promise<void> {
    const { error: deleteError } = await this.db
      .from('source_chunks')
      .delete()
      .eq('source_id', job.sourceId)
      .eq('notebook_id', job.notebookId)
      .eq('user_id', job.userId);
    if (deleteError) throw new Error(`deleting old chunks failed: ${deleteError.message}`);

    const rows: TablesInsert<'source_chunks'>[] = chunks.map((chunk, index) => ({
      source_id: job.sourceId,
      notebook_id: job.notebookId,
      user_id: job.userId,
      ordinal: chunk.ordinal,
      content: chunk.content,
      page_start: chunk.pageStart,
      page_end: chunk.pageEnd,
      heading_path: chunk.headingPath,
      char_start: chunk.charStart,
      char_end: chunk.charEnd,
      token_count: chunk.tokenCount,
      embedding: toVectorLiteral(embeddings[index] ?? []),
      // Computed by the source_chunks_set_fts trigger from the notebook language.
      fts: '',
    }));
    for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH) {
      // Sequential: keeps request sizes bounded.
      // oxlint-disable-next-line no-await-in-loop
      const { error } = await this.db
        .from('source_chunks')
        .insert(rows.slice(i, i + CHUNK_INSERT_BATCH));
      if (error) {
        // A missing source/notebook (deleted meanwhile) surfaces as a foreign key violation.
        throw new Error(`inserting chunks failed: ${error.message}`);
      }
    }
  }

  private async handleFailure(
    job: IngestSourceJob,
    context: JobContext,
    tag: string,
    error: unknown,
  ): Promise<void> {
    // Deleted meanwhile (explicitly detected, or an error caused by the deletion): stop quietly.
    if (error instanceof SourceGoneError || !(await this.existsOrUnknown(job))) {
      this.logger.log(`${tag}: source was deleted during processing, stopping`);
      await this.removeOrphanedSnapshot(job);
      return;
    }

    if (error instanceof IngestError && !context.signal.aborted) {
      this.logger.warn(`${tag}: failed: ${error.message}`);
      await this.markFailed(job, tag, error.message);
      return; // permanent: retrying would fail the same way
    }

    const finalAttempt = context.retryCount >= RETRY_LIMIT;
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `${tag}: attempt ${context.retryCount + 1}/${RETRY_LIMIT + 1} failed: ${detail}`,
      error instanceof Error ? error.stack : undefined,
    );
    if (finalAttempt) {
      await this.markFailed(job, tag, GENERIC_FAILURE);
    } else {
      // Shown as queued again until pg-boss retries the job.
      await this.updateSource(job, { status: 'pending', error: null }).catch(() => undefined);
    }
    throw error;
  }

  /** False only if the source is known to be gone; true if it exists or the check failed. */
  private async existsOrUnknown(job: IngestSourceJob): Promise<boolean> {
    try {
      return (await this.loadSource(job)) !== null;
    } catch {
      return true;
    }
  }

  private async markFailed(job: IngestSourceJob, tag: string, message: string): Promise<void> {
    try {
      await this.updateSource(job, { status: 'failed', error: message });
    } catch (error) {
      if (!(error instanceof SourceGoneError)) {
        this.logger.error(`${tag}: could not mark the source as failed`);
      }
    }
  }

  /** A URL snapshot written after the API removed the folder would otherwise stay behind. */
  private async removeOrphanedSnapshot(job: IngestSourceJob): Promise<void> {
    const path = `${job.userId}/${job.notebookId}/${job.sourceId}/${SNAPSHOT_FILE_NAME}`;
    await this.db.storage
      .from(STORAGE_BUCKETS.sources)
      .remove([path])
      .catch(() => undefined);
  }
}
