import type { INestApplication } from '@nestjs/common';
import type { ApiEnv } from './config/env.js';
import { TrpcService } from './trpc/trpc.service.js';

/** HTTP setup shared by main.ts and integration tests. */
export function configureApp(app: INestApplication, env: ApiEnv): void {
  app.enableCors({ origin: env.CORS_ORIGIN, credentials: true });
  app.use('/trpc', app.get(TrpcService).middleware());
}
