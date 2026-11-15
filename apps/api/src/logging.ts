import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { ApiEnv } from './config/env.js';

const REQUEST_ID_HEADER = 'x-request-id';
const REQUEST_ID_PATTERN = /^[\w-]{1,128}$/;

/**
 * Structured JSON logs (pino) with a request id per request. Pretty-printed only in a local
 * terminal; secrets in headers are redacted.
 */
export function loggerParams(env: Pick<ApiEnv, 'LOG_LEVEL'>): Params {
  const pretty = process.env.NODE_ENV !== 'production' && process.stdout.isTTY;
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      base: { service: 'api' },
      ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const incoming = req.headers[REQUEST_ID_HEADER];
        const id =
          typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
            ? incoming
            : randomUUID();
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      autoLogging: { ignore: (req: IncomingMessage) => req.url === '/healthz' },
      customLogLevel: (_req, res, error) =>
        error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    },
  };
}
