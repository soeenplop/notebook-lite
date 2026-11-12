import type { NextConfig } from 'next';

// Local development: scripts/next.mjs loads the repo-root `.env` (see `.env.example`).
// In production the variables come from the deployment environment
// (NEXT_PUBLIC_* must be present at build time, they are inlined into the client bundle).

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
