/** The authenticated Supabase user of a request. Plain type: shared with the tRPC router. */
export interface AuthUser {
  id: string;
  email: string | null;
  /** The verified access token; used to create an RLS-scoped Supabase client. */
  accessToken: string;
}

export class UnauthorizedError extends Error {
  override readonly name = 'UnauthorizedError';
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function parseBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
