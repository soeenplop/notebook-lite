import 'reflect-metadata';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestKeys, type TestKeys, testEnv } from '../testing/fixtures.js';
import { AuthService } from './auth.service.js';
import { parseBearerToken, UnauthorizedError } from './auth.types.js';

describe('AuthService', () => {
  let keys: TestKeys;
  let auth: AuthService;

  beforeAll(async () => {
    keys = await createTestKeys();
    auth = new AuthService(testEnv, keys.jwks);
  });

  it('accepts a valid user token', async () => {
    const token = await keys.sign({ sub: 'u-1', email: 'a@example.com' });
    await expect(auth.verify(token)).resolves.toEqual({
      id: 'u-1',
      email: 'a@example.com',
      accessToken: token,
    });
  });

  it.each([
    ['expired', () => keys.sign({}, { expiresIn: Math.floor(Date.now() / 1000) - 60 })],
    ['wrong issuer', () => keys.sign({}, { issuer: 'https://evil.supabase.co/auth/v1' })],
    ['wrong audience', () => keys.sign({}, { audience: 'other' })],
    ['anon role', () => keys.sign({ role: 'anon' })],
    ['malformed', () => Promise.resolve('not-a-jwt')],
  ])('rejects a token that is %s', async (_case, makeToken) => {
    await expect(auth.verify(await makeToken())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects a token signed by another key', async () => {
    const other = await createTestKeys();
    await expect(auth.verify(await other.sign())).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('authenticate() returns null without header and rejects malformed headers', async () => {
    await expect(auth.authenticate(undefined)).resolves.toBeNull();
    await expect(auth.authenticate('Basic abc')).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('parseBearerToken', () => {
  it('extracts the token', () => {
    expect(parseBearerToken('Bearer abc.def')).toBe('abc.def');
    expect(parseBearerToken('bearer   xyz ')).toBe('xyz');
  });

  it('rejects anything else', () => {
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken(['Bearer a'])).toBeNull();
    expect(parseBearerToken('Bearer')).toBeNull();
    expect(parseBearerToken('Bearer a b')).toBeNull();
  });
});
