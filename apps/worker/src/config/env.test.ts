import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv({})).toEqual({ WORKER_PORT: 4001, LOG_LEVEL: 'info' });
  });

  it('fails fast on invalid values', () => {
    expect(() => loadEnv({ WORKER_PORT: 'abc' })).toThrow(/WORKER_PORT/);
    expect(() => loadEnv({ LOG_LEVEL: 'loud' })).toThrow(/Invalid worker environment/);
  });
});
