import { z } from 'zod';

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_API_URL: z.url(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cached: PublicEnv | undefined;

/**
 * Public (browser-safe) configuration. Each variable is referenced explicitly so Next.js can
 * inline it into the client bundle.
 */
export function publicEnv(): PublicEnv {
  cached ??= publicEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  });
  return cached;
}
