import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/** Supabase client for Client Components (session lives in cookies). */
export function createClient() {
  const env = publicEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
