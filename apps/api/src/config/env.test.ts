import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const supabase = {
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
  DATABASE_URL: 'postgresql://postgres:secret@db.example.com:5432/postgres',
  OPENAI_API_KEY: 'sk-test',
};

describe('loadEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = loadEnv({
      ...supabase,
      SUPABASE_URL: 'https://ref.supabase.co/',
      CORS_ORIGIN: 'http://localhost:3000, https://notebook-lite.soeenplop.dev',
    });
    expect(env).toEqual({
      SUPABASE_URL: 'https://ref.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
      DATABASE_URL: 'postgresql://postgres:secret@db.example.com:5432/postgres',
      API_PORT: 4000,
      CORS_ORIGIN: ['http://localhost:3000', 'https://notebook-lite.soeenplop.dev'],
      LOG_LEVEL: 'info',
      RATE_LIMIT_PER_MINUTE: 300,
      CHAT_MESSAGES_PER_MINUTE: 10,
      OPENAI_API_KEY: 'sk-test',
      OPENAI_CHAT_MODEL: 'gpt-6.1-terra',
      OPENAI_EMBEDDING_MODEL: 'text-embedding-3-large',
    });
  });

  it('coerces the port', () => {
    expect(
      loadEnv({ ...supabase, CORS_ORIGIN: 'http://localhost:3000', API_PORT: '8080' }).API_PORT,
    ).toBe(8080);
  });

  it('fails fast on missing or invalid values', () => {
    expect(() => loadEnv({})).toThrow(/CORS_ORIGIN/);
    expect(() =>
      loadEnv({ ...supabase, CORS_ORIGIN: 'http://localhost:3000', DATABASE_URL: 'mysql://x' }),
    ).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...supabase, CORS_ORIGIN: 'not a url' })).toThrow(
      /Invalid API environment/,
    );
    expect(() => loadEnv({ CORS_ORIGIN: 'http://localhost:3000' })).toThrow(/SUPABASE_URL/);
    const { OPENAI_API_KEY: _key, ...withoutOpenAi } = supabase;
    expect(() => loadEnv({ ...withoutOpenAi, CORS_ORIGIN: 'http://localhost:3000' })).toThrow(
      /OPENAI_API_KEY/,
    );
  });
});
