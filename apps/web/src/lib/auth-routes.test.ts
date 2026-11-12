import { describe, expect, it } from 'vitest';
import { isPublicPath, safeNextPath } from './auth-routes';

describe('isPublicPath', () => {
  it('allows login and auth routes', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/auth/callback')).toBe(true);
    expect(isPublicPath('/auth/sign-out')).toBe(true);
  });

  it('protects everything else', () => {
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/notebooks/1')).toBe(false);
    expect(isPublicPath('/login-hijack')).toBe(false);
    expect(isPublicPath('/authx')).toBe(false);
  });
});

describe('safeNextPath', () => {
  it('keeps same-origin paths', () => {
    expect(safeNextPath('/notebooks/1?tab=chat')).toBe('/notebooks/1?tab=chat');
  });

  it('rejects open redirects and empty values', () => {
    for (const value of [
      '//evil.com',
      '/\\evil.com',
      'https://evil.com',
      'evil',
      '',
      null,
      undefined,
    ]) {
      expect(safeNextPath(value)).toBe('/');
    }
  });
});
