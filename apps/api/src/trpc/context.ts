import type { AiModels } from '@notebook-lite/ai';
import type { JobData, QueueName } from '@notebook-lite/shared';
import type { AuthUser } from '../auth/auth.types.js';
import type { Db } from '../supabase/types.js';
import type { UserRateLimiter } from './user-rate-limiter.js';

/** Per-request tRPC context. Plain types only: this file is part of the shared router type. */
export interface TrpcContext {
  user: AuthUser | null;
  /** RLS-scoped client for `user`; null for anonymous requests. */
  supabase: Db | null;
  /** Enqueues background jobs for the worker (pg-boss). */
  jobs: JobSender;
  /** Language and embedding models (mocked in tests). */
  ai: AiModels;
  /** Per-user limits for expensive procedures. */
  rateLimiter: UserRateLimiter;
  limits: RequestLimits;
}

/** Per-user quotas, configured through the environment. */
export interface RequestLimits {
  podcastSuggestionsPerHour: number;
  podcastsPerDay: number;
}

/**
 * Enqueues a validated job and returns its id (null if a duplicate `singletonKey` was dropped).
 * Payloads must carry the caller's user id: the worker scopes its service-role queries by it.
 */
export interface JobSender {
  send<Q extends QueueName>(
    name: Q,
    data: JobData<Q>,
    options?: { singletonKey?: string },
  ): Promise<string | null>;
}
