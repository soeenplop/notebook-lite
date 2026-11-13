import {
  type AiModels,
  embedQuery,
  type HistoryMessage,
  type PromptExcerpt,
  rewriteQuery,
  selectContext,
  toVectorLiteral,
} from '@notebook-lite/ai';
import type { MatchedChunk } from '@notebook-lite/db';
import { type Citation, type LanguageCode, toCitationQuote } from '@notebook-lite/shared';
import type { Db } from '../supabase/types.js';

/** Candidates returned by `match_chunks` after RRF fusion, before the token budget. */
export const RETRIEVAL_MATCH_COUNT = 12;

export interface RetrieveOptions {
  /** The caller's RLS-scoped client: `match_chunks` is security invoker. */
  db: Db;
  models: Pick<AiModels, 'chat' | 'embedding'>;
  notebookId: string;
  /** The notebook language (query rewriting and full-text search). */
  language: LanguageCode;
  /** Selected, ready sources of the chat with their titles (for citations). */
  sources: ReadonlyMap<string, string>;
  history: readonly HistoryMessage[];
  question: string;
  abortSignal?: AbortSignal;
}

export interface RetrievedContext {
  /** The search query actually used (rewritten for follow-ups). */
  query: string;
  /** Numbered excerpts for the answer prompt. */
  excerpts: PromptExcerpt[];
  /** Marker → excerpt map sent to the client and snapshotted with the answer. */
  citations: Citation[];
}

/**
 * Grounded-chat retrieval: rewrite the question into a standalone query in the notebook
 * language, embed it, run the hybrid `match_chunks` search over the selected sources (as the
 * user, so RLS applies), and number the chunks that fit the context budget as [1]..[n].
 */
export async function retrieveContext(options: RetrieveOptions): Promise<RetrievedContext> {
  const { db, models, notebookId, language, sources, history, question, abortSignal } = options;
  const signal = abortSignal ? { abortSignal } : {};

  const query = await rewriteQuery({ model: models.chat, language, history, question, ...signal });
  const embedding = await embedQuery(models.embedding, query, signal);

  const { data, error } = await db.rpc('match_chunks', {
    p_notebook_id: notebookId,
    p_query_embedding: toVectorLiteral(embedding),
    p_query_text: query,
    p_source_ids: [...sources.keys()],
    p_match_count: RETRIEVAL_MATCH_COUNT,
  });
  if (error) throw new Error(`match_chunks failed: ${error.code} ${error.message}`);

  const rows: MatchedChunk[] = data;
  const context = selectContext(rows.filter((row) => sources.has(row.source_id)));
  const excerpts: PromptExcerpt[] = [];
  const citations: Citation[] = [];
  for (const { marker, chunk } of context) {
    const sourceTitle = sources.get(chunk.source_id) ?? '';
    const page = chunk.page_start ?? null;
    excerpts.push({
      marker,
      sourceTitle,
      page,
      headingPath: chunk.heading_path ?? [],
      content: chunk.content,
    });
    citations.push({
      marker,
      chunkId: chunk.id,
      sourceId: chunk.source_id,
      sourceTitle,
      page,
      quote: toCitationQuote(chunk.content),
    });
  }
  return { query, excerpts, citations };
}
