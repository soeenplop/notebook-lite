import type { WorkerEnv } from '../config/env.js';

/** A complete worker environment with fake values (no real keys or voices). */
export const testEnv: WorkerEnv = {
  DATABASE_URL: 'postgres://test',
  WORKER_PORT: 0,
  LOG_LEVEL: 'info',
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
  OPENAI_API_KEY: 'sk-test',
  OPENAI_CHAT_MODEL: 'gpt-6.1-terra',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-large',
  ELEVENLABS_API_KEY: 'xi-test',
  ELEVENLABS_MODEL_ID: 'eleven_v3',
  ELEVENLABS_VOICE_A: 'fake-voice-a',
  ELEVENLABS_VOICE_B: 'fake-voice-b',
  ELEVENLABS_BASE_URL: 'https://elevenlabs.test',
};
