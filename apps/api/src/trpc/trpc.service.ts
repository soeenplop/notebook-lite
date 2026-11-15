import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AiModels } from '@notebook-lite/ai';
import { TRPCError } from '@trpc/server';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { JobQueue } from '@notebook-lite/queue';
import { AI_MODELS } from '../ai/ai-models.provider.js';
import { AuthService } from '../auth/auth.service.js';
import { UnauthorizedError } from '../auth/auth.types.js';
import { type ApiEnv, ENV } from '../config/env.js';
import { PodcastChangeListener } from '../podcasts/podcast-change-listener.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { appRouter } from './app-router.js';
import type { RequestLimits, TrpcContext } from './context.js';
import { MemoryUserRateLimiter } from './user-rate-limiter.js';

@Injectable()
export class TrpcService {
  private readonly logger = new Logger('tRPC');
  private readonly rateLimiter = new MemoryUserRateLimiter();
  private readonly limits: RequestLimits;

  constructor(
    private readonly auth: AuthService,
    private readonly supabase: SupabaseService,
    private readonly queue: JobQueue,
    private readonly podcastChanges: PodcastChangeListener,
    @Inject(AI_MODELS) private readonly ai: AiModels,
    @Inject(ENV) env: ApiEnv,
  ) {
    this.limits = {
      podcastSuggestionsPerHour: env.PODCAST_SUGGESTIONS_PER_HOUR,
      podcastsPerDay: env.PODCASTS_PER_DAY,
    };
  }

  /** Express middleware serving the tRPC router (mounted at /trpc). */
  middleware() {
    return createExpressMiddleware({
      router: appRouter,
      createContext: async ({ req }): Promise<TrpcContext> => {
        try {
          const user = await this.auth.authenticate(req.headers.authorization);
          return {
            user,
            supabase: user ? this.supabase.forUser(user.accessToken) : null,
            jobs: this.queue,
            ai: this.ai,
            rateLimiter: this.rateLimiter,
            limits: this.limits,
            podcastChanges: this.podcastChanges,
          };
        } catch (error) {
          if (error instanceof UnauthorizedError) {
            throw new TRPCError({ code: 'UNAUTHORIZED', message: error.message });
          }
          throw error;
        }
      },
      onError: ({ error, path }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          this.logger.error(`${path ?? '<no path>'}: ${error.message}`, error.stack);
        }
      },
    });
  }
}
