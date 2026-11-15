import { z } from 'zod';

export const ENV = Symbol('ENV');

export const workerEnvSchema = z.object({
  /** Direct Postgres connection (session mode) for the pg-boss job queue. */
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
  WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
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
