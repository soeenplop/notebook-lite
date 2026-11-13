import {
  chatByIdInputSchema,
  chatChunkInputSchema,
  createChatInputSchema,
  listChatsInputSchema,
  renameChatInputSchema,
  setChatSourcesInputSchema,
} from '@notebook-lite/shared';
import { protectedProcedure, router } from '../trpc/trpc.js';
import {
  createChat,
  deleteChat,
  getChat,
  getChatChunk,
  listChats,
  renameChat,
  setChatSources,
} from './chats.repository.js';

/** Chat CRUD. Answers are streamed by the Nest controller `POST /chat/:chatId/stream`. */
export const chatsRouter = router({
  /** The notebook's chats, most recently active first. */
  list: protectedProcedure
    .input(listChatsInputSchema)
    .query(({ ctx, input }) => listChats(ctx.supabase, input.notebookId)),

  /** A chat with its source selection and messages. */
  get: protectedProcedure
    .input(chatByIdInputSchema)
    .query(({ ctx, input }) => getChat(ctx.supabase, input.id)),

  /** New chat with all ready sources of the notebook preselected. */
  create: protectedProcedure
    .input(createChatInputSchema)
    .mutation(({ ctx, input }) => createChat(ctx.supabase, input.notebookId)),

  rename: protectedProcedure
    .input(renameChatInputSchema)
    .mutation(({ ctx, input }) => renameChat(ctx.supabase, input.id, input.title)),

  delete: protectedProcedure
    .input(chatByIdInputSchema)
    .mutation(({ ctx, input }) => deleteChat(ctx.supabase, input.id)),

  setSources: protectedProcedure
    .input(setChatSourcesInputSchema)
    .mutation(({ ctx, input }) => setChatSources(ctx.supabase, input.id, input.sourceIds)),

  /** A cited excerpt for the source viewer. */
  chunk: protectedProcedure
    .input(chatChunkInputSchema)
    .query(({ ctx, input }) => getChatChunk(ctx.supabase, input.chunkId)),
});
