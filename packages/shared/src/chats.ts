import { z } from 'zod';
import { type Citation, citationListSchema } from './citations.js';
import { notebookIdSchema } from './notebooks.js';

/** Limits mirror the check constraints on public.chats. */
export const CHAT_TITLE_MAX_LENGTH = 200;
/** Longest question a user can send in one chat message. */
export const CHAT_MESSAGE_MAX_LENGTH = 4000;
/** Upper bound for the sources selected in one chat (sanity limit for `setSources`). */
export const CHAT_MAX_SOURCES = 500;

export const chatIdSchema = z.uuid();

export const chatTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(CHAT_TITLE_MAX_LENGTH, `Title must be at most ${CHAT_TITLE_MAX_LENGTH} characters`);

export const listChatsInputSchema = z.object({ notebookId: notebookIdSchema });
export const createChatInputSchema = z.object({ notebookId: notebookIdSchema });
export const chatByIdInputSchema = z.object({ id: chatIdSchema });
export const renameChatInputSchema = z.object({ id: chatIdSchema, title: chatTitleSchema });
export type RenameChatInput = z.input<typeof renameChatInputSchema>;

export const setChatSourcesInputSchema = z.object({
  id: chatIdSchema,
  /** The complete new selection (replaces the old one); duplicates are ignored. */
  sourceIds: z
    .array(z.uuid())
    .max(CHAT_MAX_SOURCES)
    .transform((ids) => [...new Set(ids)]),
});
export type SetChatSourcesInput = z.input<typeof setChatSourcesInputSchema>;

export const chatChunkInputSchema = z.object({ chunkId: z.uuid() });

export const chatSummarySchema = z.object({
  id: chatIdSchema,
  notebookId: notebookIdSchema,
  /** Null until the first exchange produced an automatic title (or the user renamed it). */
  title: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ChatSummary = z.infer<typeof chatSummarySchema>;

/** A notebook source as offered in a chat's source selector. */
export const chatSourceOptionSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  kind: z.enum(['pdf', 'docx', 'md', 'url']),
  status: z.enum(['pending', 'processing', 'ready', 'failed']),
  /** Selected for this chat. Only `ready` sources are used for answers. */
  selected: z.boolean(),
});
export type ChatSourceOption = z.infer<typeof chatSourceOptionSchema>;

export const chatRoleSchema = z.enum(['user', 'assistant']);

export const chatMessageSchema = z.object({
  id: z.uuid(),
  role: chatRoleSchema,
  content: z.string(),
  citations: citationListSchema,
  createdAt: z.iso.datetime({ offset: true }),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** A chat with its source selection (over all notebook sources) and messages, oldest first. */
export const chatDetailSchema = chatSummarySchema.extend({
  sources: z.array(chatSourceOptionSchema),
  messages: z.array(chatMessageSchema),
});
export type ChatDetail = z.infer<typeof chatDetailSchema>;

/** A cited excerpt as shown in the source viewer; null fields when unknown. */
export const chatChunkSchema = z.object({
  chunkId: z.uuid(),
  sourceId: z.uuid(),
  sourceTitle: z.string(),
  pageStart: z.number().int().nullable(),
  pageEnd: z.number().int().nullable(),
  headingPath: z.array(z.string()),
  content: z.string(),
});
export type ChatChunk = z.infer<typeof chatChunkSchema>;

// ---------------------------------------------------------------------------
// Streaming endpoint: POST /chat/:chatId/stream
// ---------------------------------------------------------------------------

/** Request body: only the new question; the API loads the history from the database. */
export const chatStreamRequestSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Message is empty')
    .max(CHAT_MESSAGE_MAX_LENGTH, `Message must be at most ${CHAT_MESSAGE_MAX_LENGTH} characters`),
});
export type ChatStreamRequest = z.input<typeof chatStreamRequestSchema>;

/**
 * Custom data parts of the chat UI-message stream (AI SDK `UIMessage` data types):
 * - `data-citations`: marker → excerpt map, sent before the answer text;
 * - `data-chat-title` (transient): the automatic title after the first exchange.
 */
export type ChatDataTypes = {
  citations: Citation[];
  'chat-title': { title: string };
};

export const chatDataPartSchemas = {
  citations: citationListSchema,
  'chat-title': z.object({ title: z.string() }),
} as const;

/** Error codes in JSON error bodies of the streaming endpoint (before the stream starts). */
export const CHAT_STREAM_ERROR_CODES = {
  noSources: 'NO_SOURCES_SELECTED',
  rateLimited: 'TOO_MANY_REQUESTS',
} as const;
