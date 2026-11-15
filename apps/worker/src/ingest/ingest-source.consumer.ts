import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { JobQueue } from '@notebook-lite/queue';
import { IngestSourceService } from './ingest-source.service.js';

/** Consumes the `ingest-source` queue (one job at a time, retries per QUEUE_SETTINGS). */
@Injectable()
export class IngestSourceConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger('IngestSource');

  constructor(
    @Inject(JobQueue) private readonly queue: JobQueue,
    @Inject(IngestSourceService) private readonly ingest: IngestSourceService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work('ingest-source', (data, job) => this.ingest.run(data, job));
    this.logger.log('Consuming ingest-source');
  }
}
