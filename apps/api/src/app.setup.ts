import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { ApiEnv } from './config/env.js';
import { apiRateLimit } from './rate-limit.js';

/** HTTP setup shared by main.ts and integration tests. Call before `app.init()`/`listen()`. */
export function configureApp(app: NestExpressApplication, env: ApiEnv): void {
  // Behind exactly one proxy (Traefik via Dokploy): use its X-Forwarded-For for client IPs.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGIN, credentials: true });
  app.use(apiRateLimit(env));
}
