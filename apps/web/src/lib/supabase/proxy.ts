import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { isPublicPath } from '@/lib/auth-routes';
import { publicEnv } from '@/lib/env';

/**
 * Refreshes the Supabase session cookies on every request and enforces sign-in for
 * non-public routes. Must run before any Server Component reads the session.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = publicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims(): getClaims() verifies the JWT
  // (via the project's JWKS) and refreshes an expired session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    if (pathname !== '/') url.searchParams.set('next', `${pathname}${search}`);
    return redirectWithCookies(url, response);
  }

  if (signedIn && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return redirectWithCookies(url, response);
  }

  return response;
}

function redirectWithCookies(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
