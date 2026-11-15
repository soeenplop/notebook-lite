import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { aiModelsProvider } from './ai/ai-models.provider.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { createSupabaseJwks, JWKS } from './auth/jwks.js';
import { type ApiEnv, ENV } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { loggerParams } from './logging.js';
import { JobQueueShutdown, jobQueueProvider } from './queue/job-queue.provider.js';
import { SupabaseService } from './supabase/supabase.service.js';
import { TrpcMiddleware } from './trpc/trpc.middleware.js';
import { TrpcService } from './trpc/trpc.service.js';

@Module({})
export class AppModule implements NestModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [LoggerModule.forRoot(loggerParams(env))],
      controllers: [HealthController],
      providers: [
        { provide: ENV, useValue: env },
        { provide: JWKS, useFactory: () => createSupabaseJwks(env) },
        AuthService,
        AuthGuard,
        SupabaseService,
        jobQueueProvider,
        JobQueueShutdown,
        aiModelsProvider,
        TrpcService,
      ],
      exports: [ENV, AuthService, AuthGuard, SupabaseService],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TrpcMiddleware).forRoutes({ path: 'trpc/*path', method: RequestMethod.ALL });
  }
}
