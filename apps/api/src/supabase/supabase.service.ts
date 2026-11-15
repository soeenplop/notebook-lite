import { Inject, Injectable } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type ApiEnv, ENV } from '../config/env.js';

@Injectable()
export class SupabaseService {
  constructor(@Inject(ENV) private readonly env: ApiEnv) {}

  /**
   * Supabase client acting as the given user: every query runs with the user's JWT, so
   * Postgres RLS applies. Create one per request; never share it between users.
   */
  forUser(accessToken: string): SupabaseClient {
    return createClient(this.env.SUPABASE_URL, this.env.SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
}
