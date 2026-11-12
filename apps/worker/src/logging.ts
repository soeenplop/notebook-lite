import type { IncomingMessage } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { WorkerEnv } from './config/env.js';

/**
 * Structured JSON logs (pino). Pretty-printed only in a local terminal. The worker's HTTP
 * server only serves health checks, so request logging is off; jobs log through Nest's Logger.
 */
export function loggerParams(env: Pick<WorkerEnv, 'LOG_LEVEL'>): Params {
  const pretty = process.env.NODE_ENV !== 'production' && process.stdout.isTTY;
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      base: { service: 'worker' },
      ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
      autoLogging: { ignore: (req: IncomingMessage) => req.url === '/healthz' },
    },
  };
}
