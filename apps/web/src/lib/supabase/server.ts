import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';

/** Supabase client for Server Components, Server Actions and Route Handlers. */
export async function createClient() {
  // Read cookies first: it marks the render as dynamic before any config is accessed.
  const cookieStore = await cookies();
  const env = publicEnv();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component: cookies are read-only there. The proxy refreshes
            // the session, so this can be ignored.
          }
        },
      },
    },
  );
}
