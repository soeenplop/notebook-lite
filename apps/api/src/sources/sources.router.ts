import {
  createSourceFromUrlInputSchema,
  createSourceInputSchema,
  listSourcesInputSchema,
  sourceByIdInputSchema,
} from '@notebook-lite/shared';
import { protectedProcedure, router } from '../trpc/trpc.js';
import {
  createSource,
  createSourceFromUrl,
  deleteSource,
  getSource,
  listSources,
} from './sources.repository.js';

export const sourcesRouter = router({
  /** A notebook's sources, newest first (polled by the web app while any is processing). */
  list: protectedProcedure
    .input(listSourcesInputSchema)
    .query(({ ctx, input }) => listSources(ctx.supabase, input.notebookId)),

  get: protectedProcedure
    .input(sourceByIdInputSchema)
    .query(({ ctx, input }) => getSource(ctx.supabase, input.notebookId, input.id)),

  /** Registers an uploaded file and queues ingestion. */
  create: protectedProcedure
    .input(createSourceInputSchema)
    .mutation(({ ctx, input }) => createSource(ctx.supabase, ctx.jobs, ctx.user.id, input)),

  /** Adds a web page by URL and queues ingestion (the worker fetches it). */
  createFromUrl: protectedProcedure
    .input(createSourceFromUrlInputSchema)
    .mutation(({ ctx, input }) => createSourceFromUrl(ctx.supabase, ctx.jobs, ctx.user.id, input)),

  delete: protectedProcedure
    .input(sourceByIdInputSchema)
    .mutation(({ ctx, input }) =>
      deleteSource(ctx.supabase, ctx.user.id, input.notebookId, input.id),
    ),
});
