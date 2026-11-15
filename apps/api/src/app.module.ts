import { type DynamicModule, Module } from '@nestjs/common';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { createSupabaseJwks, JWKS } from './auth/jwks.js';
import { type ApiEnv, ENV } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { SupabaseService } from './supabase/supabase.service.js';
import { TrpcService } from './trpc/trpc.service.js';

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      global: true,
      controllers: [HealthController],
      providers: [
        { provide: ENV, useValue: env },
        { provide: JWKS, useFactory: () => createSupabaseJwks(env) },
        AuthService,
        AuthGuard,
        SupabaseService,
        TrpcService,
      ],
      exports: [ENV, AuthService, AuthGuard, SupabaseService],
    };
  }
}
