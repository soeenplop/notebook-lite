import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser } from '../auth/auth.types.js';

/** Per-request tRPC context. Plain types only: this file is part of the shared router type. */
export interface TrpcContext {
  user: AuthUser | null;
  /** RLS-scoped client for `user`; null for anonymous requests. */
  supabase: SupabaseClient | null;
}
