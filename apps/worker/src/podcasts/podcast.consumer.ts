import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type Provider,
} from '@nestjs/common';
import type { AiModels } from '@notebook-lite/ai';
import { JobQueue, QUEUE_SETTINGS } from '@notebook-lite/queue';
import { AI_MODELS } from '../ai/ai-models.js';
import { ENV, missingPodcastConfig, type WorkerEnv } from '../config/env.js';
import { SERVICE_DB, type ServiceDb } from '../supabase/service-db.js';
import { FfmpegAudio } from './audio.js';
import { ElevenLabsClient } from './elevenlabs.client.js';
import { PodcastPipeline } from './podcast-pipeline.js';

/** Builds the pipeline from the environment. Tests override it with fakes. */
export const podcastPipelineProvider: Provider = {
  provide: PodcastPipeline,
  inject: [ENV, SERVICE_DB, AI_MODELS],
  useFactory: (env: WorkerEnv, db: ServiceDb, models: AiModels) => {
    const configError = missingPodcastConfig(env);
    return new PodcastPipeline({
      // Service role: bypasses RLS. The pipeline filters every query by the job's user id.
      db,
      models,
      tts: env.ELEVENLABS_API_KEY
        ? new ElevenLabsClient({
            apiKey: env.ELEVENLABS_API_KEY,
            modelId: env.ELEVENLABS_MODEL_ID,
            baseUrl: env.ELEVENLABS_BASE_URL,
          })
        : null,
      configError,
      audio: new FfmpegAudio(),
      logger: new Logger('PodcastPipeline'),
      retryLimit: QUEUE_SETTINGS['generate-podcast'].retryLimit ?? 0,
    });
  },
};

/** Consumes `generate-podcast` jobs, one at a time. */
@Injectable()
export class PodcastConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger('PodcastConsumer');

  constructor(
    private readonly queue: JobQueue,
    private readonly pipeline: PodcastPipeline,
    @Inject(ENV) private readonly env: WorkerEnv,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const missing = missingPodcastConfig(this.env);
    if (missing) {
      this.logger.warn(
        `Podcast audio is not configured (${missing}); podcast jobs will fail until it is set`,
      );
    }
    await this.queue.work('generate-podcast', (data, job) =>
      this.pipeline.run(data, { retryCount: job.retryCount, signal: job.signal }),
    );
    this.logger.log('Consuming generate-podcast');
  }
}
