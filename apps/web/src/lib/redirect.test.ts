import { describe, expect, it } from 'vitest';
import { redirectToPath } from './redirect';

describe('redirectToPath', () => {
  it('uses a relative Location so the public host is kept behind the proxy', () => {
    const res = redirectToPath('/login?error=link');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('/login?error=link');
  });

  it('supports 303 for form posts', () => {
    expect(redirectToPath('/login', 303).status).toBe(303);
  });

  it('never redirects off-site', () => {
    expect(redirectToPath('//evil.example').headers.get('location')).toBe('/');
    expect(redirectToPath('https://evil.example').headers.get('location')).toBe('/');
  });
});
