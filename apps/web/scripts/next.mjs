// Runs the Next.js CLI with the repo-root `.env` loaded (local development).
// `node --env-file` cannot be used: Next.js forwards Node flags to its workers via
// NODE_OPTIONS, where --env-file is not allowed. Variables already set in the environment
// (e.g. in CI or Docker) take precedence over the file.
import { existsSync } from 'node:fs';
import path from 'node:path';

const envFile = path.resolve(import.meta.dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

await import('next/dist/bin/next');
