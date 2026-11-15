import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = loadEnv({ CORS_ORIGIN: 'http://localhost:3000, https://notebook.soeenplop.dev' });
    expect(env).toEqual({
      API_PORT: 4000,
      CORS_ORIGIN: ['http://localhost:3000', 'https://notebook.soeenplop.dev'],
      LOG_LEVEL: 'info',
    });
  });

  it('coerces the port', () => {
    expect(loadEnv({ CORS_ORIGIN: 'http://localhost:3000', API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('fails fast on missing or invalid values', () => {
    expect(() => loadEnv({})).toThrow(/CORS_ORIGIN/);
    expect(() => loadEnv({ CORS_ORIGIN: 'not a url' })).toThrow(/Invalid API environment/);
  });
});
