import { initTRPC, TRPCError } from '@trpc/server';
import type { TrpcContext } from './context.js';

const t = initTRPC.context<TrpcContext>().create({
  // Stack traces in error responses only when explicitly running in development.
  isDev: process.env.NODE_ENV === 'development',
  // Subscriptions run over SSE. Pings keep proxies from closing idle streams; the max duration
  // makes clients reconnect, which re-authenticates them with a fresh access token.
  sse: {
    maxDurationMs: 15 * 60_000,
    ping: { enabled: true, intervalMs: 15_000 },
    client: { reconnectAfterInactivityMs: 30_000 },
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** Requires a signed-in user and exposes a non-null user and RLS-scoped Supabase client. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.supabase) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign-in required' });
  }
  return next({ ctx: { ...ctx, user: ctx.user, supabase: ctx.supabase } });
});
