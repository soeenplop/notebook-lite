import 'reflect-metadata';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestKeys, type TestKeys, testEnv } from '../testing/fixtures.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

function contextFor(request: { headers: Record<string, string>; user?: unknown }) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  let keys: TestKeys;
  let guard: AuthGuard;

  beforeAll(async () => {
    keys = await createTestKeys();
    guard = new AuthGuard(new AuthService(testEnv, keys.jwks));
  });

  it('attaches the user for a valid token', async () => {
    const request: { headers: Record<string, string>; user?: unknown } = {
      headers: { authorization: `Bearer ${await keys.sign({ sub: 'u-7' })}` },
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({ id: 'u-7' });
  });

  it('rejects missing or invalid tokens', async () => {
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer nope' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
