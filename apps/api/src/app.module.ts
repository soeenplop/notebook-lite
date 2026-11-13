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
import { CHAT_RATE_LIMITER, ChatController } from './chat/chat.controller.js';
import { ChatStreamService } from './chat/chat-stream.service.js';
import { UserRateLimiter } from './chat/user-rate-limiter.js';
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
      controllers: [HealthController, ChatController],
      providers: [
        { provide: ENV, useValue: env },
        { provide: JWKS, useFactory: () => createSupabaseJwks(env) },
        AuthService,
        AuthGuard,
        SupabaseService,
        jobQueueProvider,
        JobQueueShutdown,
        TrpcService,
        aiModelsProvider,
        ChatStreamService,
        {
          provide: CHAT_RATE_LIMITER,
          useFactory: () => new UserRateLimiter(env.CHAT_MESSAGES_PER_MINUTE),
        },
      ],
      exports: [ENV, AuthService, AuthGuard, SupabaseService],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TrpcMiddleware).forRoutes({ path: 'trpc/*path', method: RequestMethod.ALL });
  }
}
