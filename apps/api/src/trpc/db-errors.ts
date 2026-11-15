import { TRPCError } from '@trpc/server';

/** The parts of a PostgREST error we rely on (structurally compatible with PostgrestError). */
export interface DbError {
  code: string;
  message: string;
}

/**
 * Translates a Supabase/PostgREST error into a TRPCError. Only constraint and permission errors
 * carry their message to the client; anything else becomes a generic internal error (the
 * original is attached as `cause` for server-side logging).
 */
export function toTrpcError(error: DbError): TRPCError {
  switch (error.code) {
    // check_violation, not_null_violation, invalid_text_representation, string_data_right_truncation
    case '23514':
    case '23502':
    case '22P02':
    case '22001':
      return new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid input', cause: error });
    // foreign_key_violation: the referenced row does not exist for this user
    case '23503':
    // PostgREST: .single() matched no row
    case 'PGRST116':
      return new TRPCError({ code: 'NOT_FOUND', message: 'Not found', cause: error });
    // unique_violation (e.g. a client-generated id that already exists)
    case '23505':
      return new TRPCError({ code: 'CONFLICT', message: 'Already exists', cause: error });
    // insufficient_privilege (RLS or grants)
    case '42501':
      return new TRPCError({ code: 'FORBIDDEN', message: 'Forbidden', cause: error });
    default:
      return new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Database error',
        cause: error,
      });
  }
}

export function notFound(what: string): TRPCError {
  return new TRPCError({ code: 'NOT_FOUND', message: `${what} not found` });
}
