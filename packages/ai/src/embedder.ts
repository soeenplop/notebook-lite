import { type EmbeddingModel, embedMany } from 'ai';
import { EMBEDDING_DIMENSIONS } from './config.js';
import { countTokens } from './tokens.js';

export interface EmbedOptions {
  /** Max inputs per request (OpenAI: 2048). */
  maxInputsPerCall?: number;
  /** Max input tokens per request (OpenAI: 300k; kept lower for headroom). */
  maxTokensPerCall?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
}

export interface EmbedResult {
  /** One vector per input, in input order. */
  embeddings: number[][];
  /** Input tokens billed by the provider (0 if it does not report usage). */
  usageTokens: number;
}

const DEFAULTS = { maxInputsPerCall: 512, maxTokensPerCall: 200_000, maxRetries: 3 };

/**
 * Embeds texts with the embedding model in token-aware batches, one request at a time, and
 * checks that every vector has {@link EMBEDDING_DIMENSIONS} dimensions.
 */
export async function embedTexts(
  model: EmbeddingModel,
  texts: string[],
  options: EmbedOptions = {},
): Promise<EmbedResult> {
  const opts = { ...DEFAULTS, ...options };
  const embeddings: number[][] = [];
  let usageTokens = 0;

  for (const batch of batchTexts(texts, opts.maxInputsPerCall, opts.maxTokensPerCall)) {
    // Sequential on purpose: stays within provider rate limits during ingestion.
    // oxlint-disable-next-line no-await-in-loop
    const result = await embedMany({
      model,
      values: batch,
      maxRetries: opts.maxRetries,
      ...(opts.abortSignal ? { abortSignal: opts.abortSignal } : {}),
    });
    for (const embedding of result.embeddings) {
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `embedding has ${embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
        );
      }
      embeddings.push(embedding);
    }
    usageTokens += result.usage.tokens;
  }
  return { embeddings, usageTokens };
}

/** Embeds a single search query. */
export async function embedQuery(
  model: EmbeddingModel,
  query: string,
  options: Omit<EmbedOptions, 'maxInputsPerCall' | 'maxTokensPerCall'> = {},
): Promise<number[]> {
  const { embeddings } = await embedTexts(model, [query], options);
  const [embedding] = embeddings;
  if (!embedding) throw new Error('embedding model returned no vector');
  return embedding;
}

/** Splits texts into consecutive batches within the input-count and token limits. */
export function batchTexts(texts: string[], maxInputs: number, maxTokens: number): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchTokens = 0;

  for (const text of texts) {
    const tokens = countTokens(text);
    if (batch.length > 0 && (batch.length >= maxInputs || batchTokens + tokens > maxTokens)) {
      batches.push(batch);
      batch = [];
      batchTokens = 0;
    }
    batch.push(text);
    batchTokens += tokens;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/**
 * pgvector text format (`[0.1,0.2,…]`) for `halfvec` columns and `match_chunks` arguments,
 * as accepted by PostgREST / supabase-js.
 */
export function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}
