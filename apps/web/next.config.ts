import type { NextConfig } from 'next';

// Local development: scripts/next.mjs loads the repo-root `.env` (see `.env.example`) and checks
// that the build-time NEXT_PUBLIC_* values are set. In production the variables come from the
// deployment environment.

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
