import { type DynamicModule, Module } from '@nestjs/common';
import { ENV, type WorkerEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';

/**
 * Root module of the background worker. Queue consumers (pg-boss) are added here in later
 * milestones; the HTTP server only serves the internal health check.
 */
@Module({})
export class WorkerModule {
  static forRoot(env: WorkerEnv): DynamicModule {
    return {
      module: WorkerModule,
      global: true,
      controllers: [HealthController],
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
