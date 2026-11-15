import type { NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/auth-routes';
import { redirectToPath } from '@/lib/redirect';
import { createClient } from '@/lib/supabase/server';

/**
 * Target of the emailed sign-in link (PKCE flow): exchanges the one-time code for a session
 * cookie. Only works in the browser that requested the link (the code verifier is a cookie).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectToPath(next);
  }

  return redirectToPath('/login?error=link');
}
