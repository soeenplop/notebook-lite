import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
  bufferLogs: true,
});
const logger = app.get(Logger);
app.useLogger(logger);
configureApp(app, env);
app.enableShutdownHooks();
await app.listen(env.API_PORT);
logger.log(`API listening on port ${env.API_PORT}`, 'Bootstrap');
