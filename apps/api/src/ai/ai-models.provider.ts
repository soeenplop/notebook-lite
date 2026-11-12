import type { Provider } from '@nestjs/common';
import { type AiModels, createAiModels } from '@notebook-lite/ai';
import { type ApiEnv, ENV } from '../config/env.js';

export const AI_MODELS = Symbol('AI_MODELS');

/** OpenAI-backed models (tests override AI_MODELS with mocks). Creating them makes no request. */
export const aiModelsProvider: Provider = {
  provide: AI_MODELS,
  inject: [ENV],
  useFactory: (env: ApiEnv): AiModels => createAiModels(env),
};
