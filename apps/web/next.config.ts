import type { NextConfig } from 'next';

// Local development: scripts/next.mjs loads the repo-root `.env` (see `.env.example`).
// In production the variables come from the deployment environment
// (NEXT_PUBLIC_* must be present at build time, they are inlined into the client bundle).

// NEXT_PUBLIC_* values are inlined into the client bundle at build time, so they must be set
// for `next build` (CI uses placeholders). Fail early with a clear message instead of during
// prerendering.
const REQUIRED_PUBLIC_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_API_URL',
] as const;
const missing = REQUIRED_PUBLIC_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Missing build-time environment variables: ${missing.join(', ')}`);
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
