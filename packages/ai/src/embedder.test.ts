import { MockEmbeddingModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from './config.js';
import { batchTexts, embedQuery, embedTexts, toVectorLiteral } from './embedder.js';

function mockModel(dimensions = EMBEDDING_DIMENSIONS) {
  return new MockEmbeddingModelV4({
    maxEmbeddingsPerCall: 2048,
    doEmbed: ({ values }) =>
      Promise.resolve({
        embeddings: values.map((value) => Array.from({ length: dimensions }, () => value.length)),
        usage: { tokens: values.length },
        warnings: [],
      }),
  });
}

describe('embedTexts', () => {
  it('embeds in batches and keeps the input order', async () => {
    const model = mockModel();
    const texts = ['a', 'bb', 'ccc', 'dddd', 'eeeee'];
    const result = await embedTexts(model, texts, { maxInputsPerCall: 2 });

    expect(model.doEmbedCalls.map((call) => call.values)).toEqual([
      ['a', 'bb'],
      ['ccc', 'dddd'],
      ['eeeee'],
    ]);
    expect(result.embeddings.map((embedding) => embedding[0])).toEqual([1, 2, 3, 4, 5]);
    expect(result.usageTokens).toBe(5);
  });

  it('rejects vectors with the wrong dimensions', async () => {
    await expect(embedTexts(mockModel(1536), ['x'])).rejects.toThrow(/1536 dimensions/);
  });

  it('embeds a single query', async () => {
    await expect(embedQuery(mockModel(), 'hello')).resolves.toHaveLength(EMBEDDING_DIMENSIONS);
  });
});

describe('batchTexts', () => {
  it('respects the token budget per batch', () => {
    const long = 'word '.repeat(100);
    expect(batchTexts([long, long, long], 10, 250).map((batch) => batch.length)).toEqual([2, 1]);
  });

  it('puts an oversized text into its own batch', () => {
    expect(batchTexts(['word '.repeat(50), 'x'], 10, 10)).toHaveLength(2);
  });
});

describe('toVectorLiteral', () => {
  it('formats the pgvector text representation', () => {
    expect(toVectorLiteral([0.5, -1, 2])).toBe('[0.5,-1,2]');
  });
});
