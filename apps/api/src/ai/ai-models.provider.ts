import type { Provider } from '@nestjs/common';
import { type AiModels, createAiModels } from '@notebook-lite/ai';
import { type ApiEnv, ENV } from '../config/env.js';

/** Injection token for the OpenAI-backed models; tests override it with mock models. */
export const AI_MODELS = Symbol('AI_MODELS');

export const aiModelsProvider: Provider = {
  provide: AI_MODELS,
  inject: [ENV],
  useFactory: (env: ApiEnv): AiModels => createAiModels(env),
};
