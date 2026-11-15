import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type { ApiEnv } from '../config/env.js';

/** Injection token for the key set used to verify Supabase access tokens. */
export const JWKS = Symbol('JWKS');
export type Jwks = JWTVerifyGetKey;

/** Supabase publishes its asymmetric JWT signing keys here (cached and refreshed by jose). */
export function createSupabaseJwks(env: Pick<ApiEnv, 'SUPABASE_URL'>): Jwks {
  return createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
}
