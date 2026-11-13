import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  const required = {
    DATABASE_URL: 'postgresql://postgres:secret@db.example.com:5432/postgres',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    OPENAI_API_KEY: 'sk-test',
  };

  it('applies defaults', () => {
    expect(loadEnv(required)).toEqual({
      ...required,
      WORKER_PORT: 4001,
      LOG_LEVEL: 'info',
      OPENAI_CHAT_MODEL: 'gpt-6.1-terra',
      OPENAI_EMBEDDING_MODEL: 'text-embedding-3-large',
    });
  });

  it('fails fast on invalid values', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...required, DATABASE_URL: 'https://example.com' })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => loadEnv({ ...required, WORKER_PORT: 'abc' })).toThrow(/WORKER_PORT/);
    expect(() => loadEnv({ ...required, LOG_LEVEL: 'loud' })).toThrow(/Invalid worker environment/);
  });

  it('requires Supabase service access and an OpenAI key', () => {
    expect(() => loadEnv({ ...required, SUPABASE_URL: 'not a url' })).toThrow(/SUPABASE_URL/);
    expect(() => loadEnv({ ...required, SUPABASE_SECRET_KEY: '' })).toThrow(/SUPABASE_SECRET_KEY/);
    expect(() => loadEnv({ ...required, OPENAI_API_KEY: '' })).toThrow(/OPENAI_API_KEY/);
  });
});
