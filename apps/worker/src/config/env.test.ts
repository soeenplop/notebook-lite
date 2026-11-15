import { describe, expect, it } from 'vitest';
import { loadEnv, missingPodcastConfig } from './env.js';

describe('loadEnv', () => {
  const required = {
    DATABASE_URL: 'postgresql://postgres:secret@db.example.com:5432/postgres',
    SUPABASE_URL: 'https://ref.supabase.co/',
    SUPABASE_SECRET_KEY: 'sb_secret_x',
    OPENAI_API_KEY: 'sk-test',
  };

  it('applies defaults', () => {
    expect(loadEnv(required)).toEqual({
      ...required,
      SUPABASE_URL: 'https://ref.supabase.co',
      WORKER_PORT: 4001,
      LOG_LEVEL: 'info',
      OPENAI_CHAT_MODEL: 'gpt-6.1-terra',
      OPENAI_EMBEDDING_MODEL: 'text-embedding-3-large',
      ELEVENLABS_MODEL_ID: 'eleven_v3',
      ELEVENLABS_BASE_URL: 'https://api.elevenlabs.io',
    });
  });

  it('fails fast on invalid values', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ ...required, DATABASE_URL: 'https://example.com' })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => loadEnv({ ...required, WORKER_PORT: 'abc' })).toThrow(/WORKER_PORT/);
    expect(() => loadEnv({ ...required, LOG_LEVEL: 'loud' })).toThrow(/Invalid worker environment/);
    expect(() => loadEnv({ ...required, SUPABASE_SECRET_KEY: '' })).toThrow(/SUPABASE_SECRET_KEY/);
    expect(() => loadEnv({ ...required, OPENAI_API_KEY: undefined })).toThrow(/OPENAI_API_KEY/);
  });

  it('treats empty ElevenLabs values as unset and reports what podcasts need', () => {
    const env = loadEnv({ ...required, ELEVENLABS_API_KEY: ' ' });
    expect(env.ELEVENLABS_API_KEY).toBeUndefined();
    expect(missingPodcastConfig(env)).toBe('missing ELEVENLABS_API_KEY');

    const complete = loadEnv({ ...required, ELEVENLABS_API_KEY: 'xi-test' });
    expect(missingPodcastConfig(complete)).toBeNull();
  });
});
