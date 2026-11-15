import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';
import { JobQueue } from '@notebook-lite/queue';
import { ENV, type WorkerEnv } from '../config/env.js';

/** The worker's pg-boss connection. It also runs pg-boss maintenance (supervise). */
export const jobQueueProvider: Provider = {
  provide: JobQueue,
  inject: [ENV],
  useFactory: (env: WorkerEnv) => {
    const logger = new Logger('JobQueue');
    return JobQueue.connect({
      connectionString: env.DATABASE_URL,
      applicationName: 'notebook-lite-worker',
      poolSize: 4,
      supervise: true,
      onError: (error) => logger.error(error.message, error.stack),
    });
  },
};

/**
 * Connects at startup (installing or migrating the pg-boss schema and creating the queues) and
 * drains active jobs on shutdown. Consumers register with `JobQueue.work` in their own
 * `onApplicationBootstrap`.
 */
@Injectable()
export class JobQueueLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('JobQueue');

  constructor(private readonly queue: JobQueue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.start();
    this.logger.log('Job queue connected');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.stop();
  }
}
