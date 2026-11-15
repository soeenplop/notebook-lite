import type { Provider } from '@nestjs/common';
import { type AiModels, createAiModels } from '@notebook-lite/ai';
import { ENV, type WorkerEnv } from '../config/env.js';

export const AI_MODELS = Symbol('AI_MODELS');

/** OpenAI models (chat, embeddings). Tests override this provider with mock models. */
export const aiModelsProvider: Provider = {
  provide: AI_MODELS,
  inject: [ENV],
  useFactory: (env: WorkerEnv): AiModels => createAiModels(env),
};
