import { NextResponse } from 'next/server';
import { safeNextPath } from './auth-routes';

/**
 * Redirect to a path on this site using a relative `Location` header.
 *
 * Behind the reverse proxy, `request.nextUrl.origin` in route handlers is the container's bind
 * address (e.g. `https://0.0.0.0:3000`), not the public host. A relative Location is resolved by
 * the browser against the URL it actually requested. Only same-site paths are accepted.
 */
export function redirectToPath(path: string, status: 303 | 307 = 307): NextResponse {
  return new NextResponse(null, { status, headers: { Location: safeNextPath(path) } });
}
