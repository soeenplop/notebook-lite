import { z } from 'zod';

export const ENV = Symbol('ENV');

export const apiEnvSchema = z.object({
  SUPABASE_URL: z.url().transform((url) => url.replace(/\/+$/, '')),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  /** Direct Postgres connection (session mode) for the pg-boss job queue. */
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CORS_ORIGIN: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url()).min(1)),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  /** Requests per minute and client IP across the whole API. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Parses and validates the environment. Throws with a readable message on invalid config. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  const result = apiEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid API environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
