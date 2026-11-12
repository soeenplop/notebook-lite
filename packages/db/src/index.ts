/**
 * Typed database schema, generated from the remote Supabase project.
 * Regenerate after every migration: `npm run db:types` (never edit database.types.ts by hand).
 */
export type { Database, Json, Tables, TablesInsert, TablesUpdate } from './database.types.js';
export { Constants } from './database.types.js';

import type { Database, Tables } from './database.types.js';

export type NotebookRow = Tables<'notebooks'>;
export type SourceRow = Tables<'sources'>;
export type ChatRow = Tables<'chats'>;
export type ChatSourceRow = Tables<'chat_sources'>;
export type MessageRow = Tables<'messages'>;
export type PodcastRow = Tables<'podcasts'>;
export type PodcastSourceRow = Tables<'podcast_sources'>;
export type SourceChunkRow = Tables<'source_chunks'>;

/** One row of `match_chunks` (hybrid retrieval, see the source_chunks migration). */
export type MatchedChunk = Database['public']['Functions']['match_chunks']['Returns'][number];
