import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TrpcService } from './trpc.service.js';

export const TRPC_PREFIX = '/trpc';

/**
 * Serves tRPC as a Nest middleware (instead of a raw `app.use`), so it runs after the global
 * middleware chain: request logging, rate limiting.
 */
@Injectable()
export class TrpcMiddleware implements NestMiddleware {
  private readonly handler: ReturnType<TrpcService['middleware']>;

  constructor(trpc: TrpcService) {
    this.handler = trpc.middleware();
  }

  use(req: Request, res: Response, next: NextFunction): void {
    // tRPC resolves the procedure from the URL relative to its mount point.
    if (req.url.startsWith(`${TRPC_PREFIX}/`)) req.url = req.url.slice(TRPC_PREFIX.length);
    void this.handler(req, res, next);
  }
}
