import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { aiModelsProvider } from './ai/ai-models.js';
import { ENV, type WorkerEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { IngestSourceConsumer } from './ingest/ingest-source.consumer.js';
import { IngestSourceService } from './ingest/ingest-source.service.js';
import { UrlFetcher } from './ingest/url-fetcher.js';
import { loggerParams } from './logging.js';
import { PodcastConsumer, podcastPipelineProvider } from './podcasts/podcast.consumer.js';
import { JobQueueLifecycle, jobQueueProvider } from './queue/job-queue.provider.js';
import { serviceDbProvider } from './supabase/service-db.js';

/**
 * Root module of the background worker. Queue consumers (`ingest-source`, `generate-podcast`)
 * register on the shared JobQueue; the HTTP server only serves the internal health check.
 */
@Module({})
export class WorkerModule {
  static forRoot(env: WorkerEnv): DynamicModule {
    return {
      module: WorkerModule,
      global: true,
      imports: [LoggerModule.forRoot(loggerParams(env))],
      controllers: [HealthController],
      providers: [
        { provide: ENV, useValue: env },
        jobQueueProvider,
        JobQueueLifecycle,
        serviceDbProvider,
        aiModelsProvider,
        { provide: UrlFetcher, useFactory: () => new UrlFetcher() },
        IngestSourceService,
        IngestSourceConsumer,
        podcastPipelineProvider,
        PodcastConsumer,
      ],
      exports: [ENV, jobQueueProvider, serviceDbProvider, aiModelsProvider],
    };
  }
}
