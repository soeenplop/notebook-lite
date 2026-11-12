import { notebooksRouter } from '../notebooks/notebooks.router.js';
import { podcastsRouter } from '../podcasts/podcasts.router.js';
import { protectedProcedure, router } from './trpc.js';

/**
 * Root tRPC router. The web app imports `AppRouter` type-only via `@notebook-lite/api/trpc`,
 * so this file and its imports must stay free of Nest decorators.
 */
export const appRouter = router({
  auth: router({
    me: protectedProcedure.query(({ ctx }) => ({ id: ctx.user.id, email: ctx.user.email })),
  }),
  notebooks: notebooksRouter,
  podcasts: podcastsRouter,
});

export type AppRouter = typeof appRouter;
