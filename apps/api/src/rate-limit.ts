import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { ApiEnv } from './config/env.js';

/**
 * Coarse per-IP limit for the whole API (abuse protection). Expensive operations (chat,
 * podcasts) get their own per-user limits in their tRPC procedures. Health checks are exempt.
 * Relies on `trust proxy` so the client IP comes from Traefik's X-Forwarded-For.
 */
export function apiRateLimit(env: Pick<ApiEnv, 'RATE_LIMIT_PER_MINUTE'>): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: env.RATE_LIMIT_PER_MINUTE,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.path === '/healthz',
    handler: (_req, res) => {
      res.status(429).json({ error: { message: 'Too many requests', code: 'TOO_MANY_REQUESTS' } });
    },
  });
}
