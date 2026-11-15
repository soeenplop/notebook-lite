import { EMBEDDING_DIMENSIONS } from '@notebook-lite/ai';
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../testing/fake-db.js';
import { retrieveContext } from './retrieval.js';

const notebookId = '7f4c1a52-2b8e-4a83-9d4e-0d6e5c3b2a10';
const sourceA = '0b0c6d1e-3f4a-4b5c-8d6e-7f8091a2b3c4';
const foreign = '1c1d7e2f-4a5b-4c6d-9e7f-8091a2b3c4d5';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function models(rewrite: string) {
  return {
    chat: new MockLanguageModelV4({
      doGenerate: () =>
        Promise.resolve({
          content: [{ type: 'text', text: rewrite }],
          finishReason: { unified: 'stop', raw: undefined },
          usage,
          warnings: [],
        }),
    }),
    embedding: new MockEmbeddingModelV4({
      maxEmbeddingsPerCall: 2048,
      doEmbed: ({ values }) =>
        Promise.resolve({
          embeddings: values.map(() => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 1)),
          warnings: [],
        }),
    }),
  };
}

function row(id: string, sourceId: string, tokens: number, page: number | null = null) {
  return {
    id,
    source_id: sourceId,
    content: `content of ${id}`,
    page_start: page,
    heading_path: ['H'],
    token_count: tokens,
  };
}

describe('retrieveContext', () => {
  it('rewrites follow-ups, searches as the user and numbers chunks within the budget', async () => {
    const ids = [
      'a1a1a1a1-0000-4000-8000-000000000001',
      'a1a1a1a1-0000-4000-8000-000000000002',
      'a1a1a1a1-0000-4000-8000-000000000003',
      'a1a1a1a1-0000-4000-8000-000000000004',
    ] as const;
    const { db, queries } = fakeDb({
      data: [
        row(ids[0], sourceA, 3000, 2),
        row(ids[1], foreign, 100),
        row(ids[2], sourceA, 4000),
        row(ids[3], sourceA, 2000),
      ],
      error: null,
    });
    const ai = models('standalone query');

    const result = await retrieveContext({
      db,
      models: ai,
      notebookId,
      language: 'en',
      sources: new Map([[sourceA, 'Paper']]),
      history: [{ role: 'user', content: 'earlier' }],
      question: 'and then?',
    });

    expect(result.query).toBe('standalone query');
    expect(ai.embedding.doEmbedCalls[0]?.values).toEqual(['standalone query']);
    expect(queries[0]?.table).toBe('rpc:match_chunks');
    expect(queries[0]?.ops[0]?.[1][0]).toMatchObject({
      p_notebook_id: notebookId,
      p_query_text: 'standalone query',
      p_source_ids: [sourceA],
    });
    // The foreign row is ignored; the third selected chunk exceeds the 8k token budget.
    expect(result.citations).toEqual([
      {
        marker: 1,
        chunkId: ids[0],
        sourceId: sourceA,
        sourceTitle: 'Paper',
        page: 2,
        quote: `content of ${ids[0]}`,
      },
      {
        marker: 2,
        chunkId: ids[2],
        sourceId: sourceA,
        sourceTitle: 'Paper',
        page: null,
        quote: `content of ${ids[2]}`,
      },
    ]);
    expect(result.excerpts[0]).toEqual({
      marker: 1,
      sourceTitle: 'Paper',
      page: 2,
      headingPath: ['H'],
      content: `content of ${ids[0]}`,
    });
  });

  it('fails when the search fails', async () => {
    const { db } = fakeDb({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(
      retrieveContext({
        db,
        models: models(''),
        notebookId,
        language: 'de',
        sources: new Map([[sourceA, 'Paper']]),
        history: [],
        question: 'q',
      }),
    ).rejects.toThrow(/match_chunks failed: 42501/);
  });
});
