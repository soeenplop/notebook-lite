import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type Provider,
} from '@nestjs/common';
import { createAiModels } from '@notebook-lite/ai';
import type { Database } from '@notebook-lite/db';
import { JobQueue, QUEUE_SETTINGS } from '@notebook-lite/queue';
import { createClient } from '@supabase/supabase-js';
import { ENV, missingPodcastConfig, type WorkerEnv } from '../config/env.js';
import { FfmpegAudio } from './audio.js';
import { ElevenLabsClient } from './elevenlabs.client.js';
import { PodcastPipeline } from './podcast-pipeline.js';

/** Builds the pipeline from the environment. Tests override it with fakes. */
export const podcastPipelineProvider: Provider = {
  provide: PodcastPipeline,
  inject: [ENV],
  useFactory: (env: WorkerEnv) => {
    const configError = missingPodcastConfig(env);
    return new PodcastPipeline({
      // Service role: bypasses RLS. The pipeline filters every query by the job's user id.
      db: createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
      models: createAiModels(env),
      tts: env.ELEVENLABS_API_KEY
        ? new ElevenLabsClient({
            apiKey: env.ELEVENLABS_API_KEY,
            modelId: env.ELEVENLABS_MODEL_ID,
            baseUrl: env.ELEVENLABS_BASE_URL,
          })
        : null,
      configError,
      voices: { A: env.ELEVENLABS_VOICE_A, B: env.ELEVENLABS_VOICE_B },
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
    } else if (!this.env.ELEVENLABS_VOICE_B) {
      this.logger.warn('ELEVENLABS_VOICE_B is not set; dialogue podcasts will fail');
    }
    await this.queue.work('generate-podcast', (data, job) =>
      this.pipeline.run(data, { retryCount: job.retryCount, signal: job.signal }),
    );
    this.logger.log('Consuming generate-podcast');
  }
}
