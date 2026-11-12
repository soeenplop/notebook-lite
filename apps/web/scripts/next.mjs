// Runs the Next.js CLI with the repo-root `.env` loaded (local development).
// `node --env-file` cannot be used: Next.js forwards Node flags to its workers via
// NODE_OPTIONS, where --env-file is not allowed. Variables already set in the environment
// (e.g. in CI or Docker) take precedence over the file.
import { existsSync } from 'node:fs';
import path from 'node:path';

const envFile = path.resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

// NEXT_PUBLIC_* values are inlined into the client bundle at build time, so `next build` needs
// them (CI uses placeholders). Fail early with a clear message instead of during prerendering.
const REQUIRED_BUILD_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_API_URL',
];
if (process.argv[2] === 'build') {
  const missing = REQUIRED_BUILD_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    process.stderr.write(`Missing build-time environment variables: ${missing.join(', ')}\n`);
    process.exit(1);
  }
}

await import('next/dist/bin/next');
