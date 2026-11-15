import {
  createNotebookInputSchema,
  notebookByIdInputSchema,
  updateNotebookInputSchema,
} from '@notebook-lite/shared';
import { protectedProcedure, router } from '../trpc/trpc.js';
import {
  createNotebook,
  deleteNotebook,
  getNotebook,
  listNotebooks,
  updateNotebook,
} from './notebooks.repository.js';

export const notebooksRouter = router({
  /** The caller's notebooks, most recently updated first, with item counts. */
  list: protectedProcedure.query(({ ctx }) => listNotebooks(ctx.supabase)),

  get: protectedProcedure
    .input(notebookByIdInputSchema)
    .query(({ ctx, input }) => getNotebook(ctx.supabase, input.id)),

  create: protectedProcedure
    .input(createNotebookInputSchema)
    .mutation(({ ctx, input }) => createNotebook(ctx.supabase, input)),

  update: protectedProcedure
    .input(updateNotebookInputSchema)
    .mutation(({ ctx, input }) => updateNotebook(ctx.supabase, input)),

  delete: protectedProcedure
    .input(notebookByIdInputSchema)
    .mutation(({ ctx, input }) => deleteNotebook(ctx.supabase, input.id)),
});
