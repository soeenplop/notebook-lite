import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from './config/env.js';
import { WorkerModule } from './worker.module.js';

const env = loadEnv();
const verbose = env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace';
const app = await NestFactory.create(WorkerModule.forRoot(env), {
  logger: ['fatal', 'error', 'warn', 'log', ...(verbose ? (['debug', 'verbose'] as const) : [])],
});
app.enableShutdownHooks();
await app.listen(env.WORKER_PORT);
new Logger('Bootstrap').log(`Worker health check listening on port ${env.WORKER_PORT}`);
