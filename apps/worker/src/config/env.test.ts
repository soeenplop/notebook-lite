import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  const DATABASE_URL = 'postgresql://postgres:secret@db.example.com:5432/postgres';

  it('applies defaults', () => {
    expect(loadEnv({ DATABASE_URL })).toEqual({
      DATABASE_URL,
      WORKER_PORT: 4001,
      LOG_LEVEL: 'info',
    });
  });

  it('fails fast on invalid values', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ DATABASE_URL: 'https://example.com' })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ DATABASE_URL, WORKER_PORT: 'abc' })).toThrow(/WORKER_PORT/);
    expect(() => loadEnv({ DATABASE_URL, LOG_LEVEL: 'loud' })).toThrow(
      /Invalid worker environment/,
    );
  });
});
