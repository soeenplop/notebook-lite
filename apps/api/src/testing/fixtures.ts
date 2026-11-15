import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';
import type { ApiEnv } from '../config/env.js';
import type { Jwks } from '../auth/jwks.js';
import type { JobSender } from '../trpc/context.js';

export const TEST_SUPABASE_URL = 'https://test-project.supabase.co';

export const testEnv: ApiEnv = {
  SUPABASE_URL: TEST_SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:5432/test',
  API_PORT: 0,
  CORS_ORIGIN: ['http://localhost:3000'],
  LOG_LEVEL: 'info',
  RATE_LIMIT_PER_MINUTE: 1000,
};

export interface TestKeys {
  jwks: Jwks;
  /** Signs a Supabase-like access token; override claims or options per test. */
  sign(
    claims?: JWTPayload,
    options?: { expiresIn?: string | number; issuer?: string; audience?: string },
  ): Promise<string>;
}

/** An ES256 key pair with a local JWKS, mimicking Supabase's asymmetric signing keys. */
export async function createTestKeys(): Promise<TestKeys> {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const kid = 'test-key';
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
  const jwks = createLocalJWKSet({ keys: [jwk] });

  return {
    jwks,
    sign: (claims = {}, options = {}) =>
      new SignJWT({ role: 'authenticated', email: 'user@example.com', ...claims })
        .setProtectedHeader({ alg: 'ES256', kid })
        .setSubject(typeof claims.sub === 'string' ? claims.sub : 'user-123')
        .setIssuer(options.issuer ?? `${TEST_SUPABASE_URL}/auth/v1`)
        .setAudience(options.audience ?? 'authenticated')
        .setIssuedAt()
        .setExpirationTime(options.expiresIn ?? '1h')
        .sign(privateKey),
  };
}

/** Job sender that records instead of enqueueing. */
export function fakeJobs(): JobSender & { sent: { name: string; data: unknown }[] } {
  const sent: { name: string; data: unknown }[] = [];
  return {
    sent,
    send: (name, data) => {
      sent.push({ name, data });
      return Promise.resolve(`job-${sent.length}`);
    },
  };
}
