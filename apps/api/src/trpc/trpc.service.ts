import { Injectable, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { JobQueue } from '@notebook-lite/queue';
import { AuthService } from '../auth/auth.service.js';
import { UnauthorizedError } from '../auth/auth.types.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { appRouter } from './app-router.js';
import type { TrpcContext } from './context.js';

@Injectable()
export class TrpcService {
  private readonly logger = new Logger('tRPC');

  constructor(
    private readonly auth: AuthService,
    private readonly supabase: SupabaseService,
    private readonly queue: JobQueue,
  ) {}

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
