import { type DynamicModule, Module } from '@nestjs/common';
import { type ApiEnv, ENV } from './config/env.js';
import { HealthController } from './health/health.controller.js';

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      global: true,
      controllers: [HealthController],
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
