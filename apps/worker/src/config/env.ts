import { aiEnvSchema } from '@notebook-lite/ai';
import { z } from 'zod';

export const ENV = Symbol('ENV');

/** An optional string where an empty value (`KEY=` in .env) counts as unset. */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

export const workerEnvSchema = z.object({
  /** Direct Postgres connection (session mode) for the pg-boss job queue. */
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
  WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  SUPABASE_URL: z.url().transform((url) => url.replace(/\/+$/, '')),
  /** Secret (service-role) key: bypasses RLS, so every query filters by user_id explicitly. */
  SUPABASE_SECRET_KEY: z.string().min(1),
  ...aiEnvSchema.shape,
  /**
   * ElevenLabs (podcast audio). Optional so the worker still runs ingestion without them;
   * podcast jobs fail with a clear message until they are set.
   */
  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_MODEL_ID: z.string().trim().min(1).default('eleven_v3'),
  ELEVENLABS_VOICE_A: optionalString,
  ELEVENLABS_VOICE_B: optionalString,
  ELEVENLABS_BASE_URL: z
    .url()
    .default('https://api.elevenlabs.io')
    .transform((url) => url.replace(/\/+$/, '')),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Parses and validates the environment. Throws with a readable message on invalid config. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid worker environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * What is missing for podcast audio, as one message (null when complete). Voice B is only
 * needed for dialogues and is checked per job.
 */
export function missingPodcastConfig(env: WorkerEnv): string | null {
  const missing = [
    env.ELEVENLABS_API_KEY ? null : 'ELEVENLABS_API_KEY',
    env.ELEVENLABS_VOICE_A ? null : 'ELEVENLABS_VOICE_A',
  ].filter(Boolean);
  return missing.length ? `missing ${missing.join(', ')}` : null;
}
