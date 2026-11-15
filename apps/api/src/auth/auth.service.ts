import { Inject, Injectable } from '@nestjs/common';
import { errors, jwtVerify } from 'jose';
import { type ApiEnv, ENV } from '../config/env.js';
import { type AuthUser, parseBearerToken, UnauthorizedError } from './auth.types.js';
import { JWKS, type Jwks } from './jwks.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: ApiEnv,
    @Inject(JWKS) private readonly jwks: Jwks,
  ) {}

  /** Verifies a Supabase access token (signature via JWKS, issuer, audience, expiry). */
  async verify(token: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: `${this.env.SUPABASE_URL}/auth/v1`,
        audience: 'authenticated',
      });
      if (!payload.sub || payload.role !== 'authenticated') {
        throw new UnauthorizedError('Token is not a user session');
      }
      return {
        id: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : null,
        accessToken: token,
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      if (error instanceof errors.JOSEError) {
        throw new UnauthorizedError(`Invalid access token (${error.code})`);
      }
      throw error;
    }
  }

  /**
   * Resolves the user from an Authorization header.
   * Returns null without a header; throws UnauthorizedError for an invalid token.
   */
  async authenticate(authorization: string | string[] | undefined): Promise<AuthUser | null> {
    if (authorization === undefined) return null;
    const token = parseBearerToken(authorization);
    if (!token) throw new UnauthorizedError('Malformed Authorization header');
    return this.verify(token);
  }
}
