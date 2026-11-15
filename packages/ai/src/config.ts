import { createOpenAI } from '@ai-sdk/openai';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { z } from 'zod';

/** Dimensions of `text-embedding-3-large`; must match `source_chunks.embedding halfvec(3072)`. */
export const EMBEDDING_DIMENSIONS = 3072;

export const aiEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_CHAT_MODEL: z.string().min(1).default('gpt-6.1-terra'),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-large'),
});

export type AiEnv = z.infer<typeof aiEnvSchema>;

export interface AiModels {
  /** Chat model for answers, titles, query rewriting, topics and podcast scripts. */
  chat: LanguageModel;
  /** Embedding model for chunks and queries (same model for both). */
  embedding: EmbeddingModel;
}

/** Creates the OpenAI-backed models. Tests pass mock models instead of calling this. */
export function createAiModels(env: AiEnv): AiModels {
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  return {
    chat: openai(env.OPENAI_CHAT_MODEL),
    embedding: openai.embedding(env.OPENAI_EMBEDDING_MODEL),
  };
}
