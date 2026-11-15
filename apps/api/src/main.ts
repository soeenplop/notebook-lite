import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = await NestFactory.create(AppModule.forRoot(env), {
  logger: [
    'fatal',
    'error',
    'warn',
    'log',
    ...(env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace'
      ? (['debug', 'verbose'] as const)
      : []),
  ],
});
app.enableCors({ origin: env.CORS_ORIGIN, credentials: true });
app.enableShutdownHooks();
await app.listen(env.API_PORT);
new Logger('Bootstrap').log(`API listening on port ${env.API_PORT}`);
