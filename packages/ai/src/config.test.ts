import { describe, expect, it } from 'vitest';
import { aiEnvSchema, createAiModels } from './config.js';

describe('aiEnvSchema', () => {
  it('requires the API key and defaults the models', () => {
    expect(aiEnvSchema.safeParse({}).success).toBe(false);
    expect(aiEnvSchema.parse({ OPENAI_API_KEY: 'sk-test' })).toEqual({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_CHAT_MODEL: 'gpt-6.1-terra',
      OPENAI_EMBEDDING_MODEL: 'text-embedding-3-large',
    });
  });
});

describe('createAiModels', () => {
  it('creates the configured models without calling the provider', () => {
    const models = createAiModels(aiEnvSchema.parse({ OPENAI_API_KEY: 'sk-test' }));
    expect(models.embedding).toMatchObject({ modelId: 'text-embedding-3-large' });
    expect(models.chat).toMatchObject({ modelId: 'gpt-6.1-terra' });
  });
});
