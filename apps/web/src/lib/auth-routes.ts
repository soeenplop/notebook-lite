/** Routes reachable without a session. Everything else requires sign-in. */
const PUBLIC_ROUTES = ['/login', '/auth'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * Sanitizes a post-login redirect target: only same-origin, absolute paths are allowed
 * (prevents open redirects such as `//evil.com` or `https://evil.com`).
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  return next;
}
