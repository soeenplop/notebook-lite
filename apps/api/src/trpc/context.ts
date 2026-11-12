import type { JobData, QueueName } from '@notebook-lite/shared';
import type { AuthUser } from '../auth/auth.types.js';
import type { Db } from '../supabase/types.js';

/** Per-request tRPC context. Plain types only: this file is part of the shared router type. */
export interface TrpcContext {
  user: AuthUser | null;
  /** RLS-scoped client for `user`; null for anonymous requests. */
  supabase: Db | null;
  /** Enqueues background jobs for the worker (pg-boss). */
  jobs: JobSender;
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
