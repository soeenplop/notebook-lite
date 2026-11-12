import { type NextRequest, NextResponse } from 'next/server';
import { safeNextPath } from '@/lib/auth-routes';
import { createClient } from '@/lib/supabase/server';

/**
 * Target of the emailed sign-in link (PKCE flow): exchanges the one-time code for a session
 * cookie. Only works in the browser that requested the link (the code verifier is a cookie).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }

  const login = new URL('/login', origin);
  login.searchParams.set('error', 'link');
  return NextResponse.redirect(login);
}
