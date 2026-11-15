import { Injectable, Logger, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import { JobQueue } from '@notebook-lite/queue';
import { type ApiEnv, ENV } from '../config/env.js';

/**
 * Producer-side queue. It connects lazily on the first `send`, so the API boots without a
 * database round trip. pg-boss maintenance runs in the worker.
 */
export const jobQueueProvider: Provider = {
  provide: JobQueue,
  inject: [ENV],
  useFactory: (env: ApiEnv) => {
    const logger = new Logger('JobQueue');
    return JobQueue.connect({
      connectionString: env.DATABASE_URL,
      applicationName: 'notebook-lite-api',
      poolSize: 2,
      supervise: false,
      onError: (error) => logger.error(error.message, error.stack),
    });
  },
};

/** Closes the queue connection on shutdown. */
@Injectable()
export class JobQueueShutdown implements OnApplicationShutdown {
  constructor(private readonly queue: JobQueue) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.stop();
  }
}
