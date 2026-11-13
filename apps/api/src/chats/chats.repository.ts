import {
  type ChatChunk,
  type ChatDetail,
  type ChatSummary,
  chatChunkSchema,
  chatDetailSchema,
  chatSummarySchema,
  citationListSchema,
} from '@notebook-lite/shared';
import type { Db } from '../supabase/types.js';
import { notFound, toTrpcError } from '../trpc/db-errors.js';

/**
 * Data access for chats. Every function takes the caller's RLS-scoped client, so Postgres
 * guarantees users only ever see or change their own chats. The composite foreign keys on
 * chat_sources guarantee a chat only selects sources from its own notebook. Plain functions
 * (no Nest): used by the tRPC router.
 */

const SUMMARY_COLUMNS = 'id, notebook_id, title, created_at, updated_at';

interface SummaryRow {
  id: string;
  notebook_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export function toChatSummary(row: SummaryRow): ChatSummary {
  return chatSummarySchema.parse({
    id: row.id,
    notebookId: row.notebook_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

/** The notebook's chats, most recently active first. */
export async function listChats(db: Db, notebookId: string): Promise<ChatSummary[]> {
  const { data, error } = await db
    .from('chats')
    .select(SUMMARY_COLUMNS)
    .eq('notebook_id', notebookId)
    .order('updated_at', { ascending: false });
  if (error) throw toTrpcError(error);
  return data.map(toChatSummary);
}

/** A chat with every notebook source (marked as selected or not) and all messages. */
export async function getChat(db: Db, id: string): Promise<ChatDetail> {
  const { data: chat, error } = await db
    .from('chats')
    .select(`${SUMMARY_COLUMNS}, chat_sources(source_id)`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw toTrpcError(error);
  if (!chat) throw notFound('Chat');

  const [sources, messages] = await Promise.all([
    db
      .from('sources')
      .select('id, title, kind, status')
      .eq('notebook_id', chat.notebook_id)
      .order('created_at', { ascending: true }),
    db
      .from('messages')
      .select('id, role, content, citations, created_at')
      .eq('chat_id', id)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  ]);
  if (sources.error) throw toTrpcError(sources.error);
  if (messages.error) throw toTrpcError(messages.error);

  const selected = new Set(chat.chat_sources.map((row) => row.source_id));
  return chatDetailSchema.parse({
    ...toChatSummary(chat),
    sources: sources.data.map((source) => ({
      id: source.id,
      title: source.title,
      kind: source.kind,
      status: source.status,
      selected: selected.has(source.id),
    })),
    messages: messages.data.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      // A snapshot written by the API; tolerate malformed rows instead of failing the chat.
      citations: citationListSchema.catch([]).parse(message.citations),
      createdAt: message.created_at,
    })),
  });
}

/**
 * Creates a chat in the notebook and preselects all of the notebook's `ready` sources.
 * A notebook the user cannot see fails the insert (composite FK) and becomes NOT_FOUND.
 */
export async function createChat(db: Db, notebookId: string): Promise<ChatSummary> {
  const { data: ready, error: sourcesError } = await db
    .from('sources')
    .select('id')
    .eq('notebook_id', notebookId)
    .eq('status', 'ready');
  if (sourcesError) throw toTrpcError(sourcesError);

  const { data: chat, error } = await db
    .from('chats')
    .insert({ notebook_id: notebookId })
    .select(SUMMARY_COLUMNS)
    .single();
  if (error) throw toTrpcError(error);

  if (ready.length > 0) {
    const { error: selectError } = await db.from('chat_sources').insert(
      ready.map((source) => ({
        chat_id: chat.id,
        source_id: source.id,
        notebook_id: notebookId,
      })),
    );
    if (selectError) {
      // Do not leave a half-created chat behind.
      await db.from('chats').delete().eq('id', chat.id);
      throw toTrpcError(selectError);
    }
  }
  return toChatSummary(chat);
}

export async function renameChat(db: Db, id: string, title: string): Promise<ChatSummary> {
  const { data, error } = await db
    .from('chats')
    .update({ title })
    .eq('id', id)
    .select(SUMMARY_COLUMNS)
    .maybeSingle();
  if (error) throw toTrpcError(error);
  if (!data) throw notFound('Chat');
  return toChatSummary(data);
}

/** Deletes a chat; its messages and source selection cascade. */
export async function deleteChat(db: Db, id: string): Promise<{ id: string }> {
  const { data, error } = await db.from('chats').delete().eq('id', id).select('id').maybeSingle();
  if (error) throw toTrpcError(error);
  if (!data) throw notFound('Chat');
  return { id: data.id };
}

/**
 * Replaces the chat's source selection: removes deselected sources and adds new ones (existing
 * rows stay). Sources from another notebook violate the composite FK and become NOT_FOUND.
 */
export async function setChatSources(
  db: Db,
  id: string,
  sourceIds: string[],
): Promise<{ id: string; sourceIds: string[] }> {
  const { data: chat, error } = await db
    .from('chats')
    .select('id, notebook_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw toTrpcError(error);
  if (!chat) throw notFound('Chat');

  let removal = db.from('chat_sources').delete().eq('chat_id', id);
  if (sourceIds.length > 0) removal = removal.not('source_id', 'in', `(${sourceIds.join(',')})`);
  const { error: deleteError } = await removal;
  if (deleteError) throw toTrpcError(deleteError);

  if (sourceIds.length > 0) {
    const { error: insertError } = await db.from('chat_sources').upsert(
      sourceIds.map((sourceId) => ({
        chat_id: id,
        source_id: sourceId,
        notebook_id: chat.notebook_id,
      })),
      { onConflict: 'chat_id,source_id', ignoreDuplicates: true },
    );
    if (insertError) throw toTrpcError(insertError);
  }
  return { id, sourceIds };
}

/**
 * A cited chunk for the source viewer. NOT_FOUND once the source (and with it the chunk) was
 * deleted; the web then falls back to the citation snapshot.
 */
export async function getChatChunk(db: Db, chunkId: string): Promise<ChatChunk> {
  const { data, error } = await db
    .from('source_chunks')
    .select('id, source_id, content, page_start, page_end, heading_path, sources(title)')
    .eq('id', chunkId)
    .maybeSingle();
  if (error) throw toTrpcError(error);
  if (!data) throw notFound('Excerpt');
  const source = Array.isArray(data.sources) ? data.sources[0] : data.sources;
  return chatChunkSchema.parse({
    chunkId: data.id,
    sourceId: data.source_id,
    sourceTitle: source?.title ?? '',
    pageStart: data.page_start,
    pageEnd: data.page_end,
    headingPath: data.heading_path ?? [],
    content: data.content,
  });
}
