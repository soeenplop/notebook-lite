import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadEnv } from './config/env.js';
import { WorkerModule } from './worker.module.js';

const env = loadEnv();
const app = await NestFactory.create(WorkerModule.forRoot(env), { bufferLogs: true });
const logger = app.get(Logger);
app.useLogger(logger);
app.enableShutdownHooks();
await app.listen(env.WORKER_PORT);
logger.log(`Worker health check listening on port ${env.WORKER_PORT}`, 'Bootstrap');
