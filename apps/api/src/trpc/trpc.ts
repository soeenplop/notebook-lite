import { initTRPC, TRPCError } from '@trpc/server';
import type { TrpcContext } from './context.js';

const t = initTRPC.context<TrpcContext>().create({
  // Stack traces in error responses only when explicitly running in development.
  isDev: process.env.NODE_ENV === 'development',
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** Requires a signed-in user and exposes a non-null user and RLS-scoped Supabase client. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.supabase) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign-in required' });
  }
  return next({ ctx: { user: ctx.user, supabase: ctx.supabase, jobs: ctx.jobs } });
});
