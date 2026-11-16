import { streamPodcastTopics } from '@notebook-lite/ai';
import {
  createPodcastInputSchema,
  type PodcastTopicSuggestion,
  listPodcastsInputSchema,
  podcastByIdInputSchema,
  suggestPodcastTopicsInputSchema,
} from '@notebook-lite/shared';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc/trpc.js';
import {
  createPodcast,
  deletePodcast,
  getNotebookLanguage,
  getPodcast,
  listPodcasts,
  listSourceOptions,
  requireReadySources,
} from './podcasts.repository.js';
import { podcastChangeEvents } from './podcast-changes.js';
import { sampleExcerpts } from './topic-sampling.js';

const HOUR_MS = 60 * 60 * 1000;

/** Turns a failure mid-stream into a client-safe error (the cause is logged, not sent). */
async function* withSuggestionErrors(
  topics: AsyncIterable<PodcastTopicSuggestion>,
): AsyncGenerator<PodcastTopicSuggestion, void, undefined> {
  try {
    yield* topics;
  } catch (error) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Could not suggest topics. Please try again.',
      cause: error,
    });
  }
}

export const podcastsRouter = router({
  /** Podcasts of a notebook, newest first. */
  list: protectedProcedure
    .input(listPodcastsInputSchema)
    .query(({ ctx, input }) => listPodcasts(ctx.supabase, input.notebookId)),

  /**
   * Live changes (status, title) of the caller's podcasts in a notebook, over SSE. Events carry
   * no podcast data: clients refetch `list`/`get`, so everything they show goes through RLS.
   */
  onChange: protectedProcedure
    .input(listPodcastsInputSchema)
    .subscription(({ ctx, input, signal }) =>
      podcastChangeEvents(ctx.podcastChanges, ctx.user.id, input.notebookId, signal),
    ),

  /** One podcast with script, sources and short-lived signed audio URLs once ready. */
  get: protectedProcedure
    .input(podcastByIdInputSchema)
    .query(({ ctx, input }) => getPodcast(ctx.supabase, input.id)),

  /** Sources the wizard can offer: the notebook's ready sources. */
  sourceOptions: protectedProcedure
    .input(listPodcastsInputSchema)
    .query(({ ctx, input }) => listSourceOptions(ctx.supabase, input.notebookId)),

  /**
   * Three topic suggestions from a sample of the selected sources, in the notebook language,
   * streamed one by one as the model finishes each (the web uses `httpBatchStreamLink` for this
   * procedure). Checks run before the stream starts, so they fail as ordinary errors.
   * Synchronous LLM call, so it is rate limited per user.
   */
  suggestTopics: protectedProcedure
    .input(suggestPodcastTopicsInputSchema)
    .mutation(async ({ ctx, input, signal }) => {
      const language = await getNotebookLanguage(ctx.supabase, input.notebookId);
      const sources = await requireReadySources(ctx.supabase, input.notebookId, input.sourceIds);
      const allowed = ctx.rateLimiter.consume(
        'podcast-suggestions',
        ctx.user.id,
        ctx.limits.podcastSuggestionsPerHour,
        HOUR_MS,
      );
      if (!allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many topic suggestions. Try again later or enter a topic yourself.',
        });
      }
      const excerpts = await sampleExcerpts(ctx.supabase, input.notebookId, sources);
      if (excerpts.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The selected sources contain no text to suggest topics from',
        });
      }
      // The signal aborts the LLM call when the client goes away.
      return withSuggestionErrors(
        streamPodcastTopics(ctx.ai.chat, {
          language,
          excerpts,
          ...(signal ? { abortSignal: signal } : {}),
        }),
      );
    }),

  /** Creates a podcast and enqueues its production (at most one in production per user). */
  create: protectedProcedure
    .input(createPodcastInputSchema)
    .mutation(({ ctx, input }) =>
      createPodcast(ctx.supabase, ctx.jobs, ctx.user.id, input, ctx.limits.podcastsPerDay),
    ),

  /** Deletes a podcast and its audio files. */
  delete: protectedProcedure
    .input(podcastByIdInputSchema)
    .mutation(({ ctx, input }) => deletePodcast(ctx.supabase, input.id)),
});
