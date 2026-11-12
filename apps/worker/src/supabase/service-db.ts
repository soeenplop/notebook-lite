import type { Provider } from '@nestjs/common';
import type { Database } from '@notebook-lite/db';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENV, type WorkerEnv } from '../config/env.js';

/**
 * Service-role Supabase client: bypasses RLS. Every query made with it must filter by the
 * job's `user_id` explicitly (and by notebook/entity ids), see AGENTS.md.
 */
export type ServiceDb = SupabaseClient<Database>;

export const SERVICE_DB = Symbol('SERVICE_DB');

export const serviceDbProvider: Provider = {
  provide: SERVICE_DB,
  inject: [ENV],
  useFactory: (env: WorkerEnv): ServiceDb =>
    createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
};
