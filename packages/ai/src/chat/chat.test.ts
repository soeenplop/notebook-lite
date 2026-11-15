import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import {
  cleanTitle,
  generateChatTitle,
  type RankedChunk,
  rewriteQuery,
  selectContext,
  streamGroundedAnswer,
} from './chat.js';
import { formatExcerpts, groundedAnswerInstructions } from './prompts.js';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function textModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      }),
  });
}

function streamModel(deltas: string[]) {
  return new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 't' },
            ...deltas.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
            { type: 'text-end', id: 't' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
          ],
        }),
      }),
  });
}

/** All text the mock model received (system + messages), for prompt assertions. */
function promptText(model: MockLanguageModelV4, call = 0): string {
  const calls = [...model.doGenerateCalls, ...model.doStreamCalls];
  return JSON.stringify(calls[call]?.prompt ?? []);
}

describe('rewriteQuery', () => {
  it('uses the first question as is, without an LLM call', async () => {
    const model = textModel('unused');
    await expect(
      rewriteQuery({ model, language: 'de', history: [], question: 'Was ist X?' }),
    ).resolves.toBe('Was ist X?');
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('rewrites follow-ups into a standalone query in the notebook language', async () => {
    const model = textModel('  "Gründungsjahr der Firma Acme"\n');
    const query = await rewriteQuery({
      model,
      language: 'de',
      history: [
        { role: 'user', content: 'Who founded Acme?' },
        { role: 'assistant', content: 'Jane Doe founded Acme [1].' },
      ],
      question: 'When was that?',
    });
    expect(query).toBe('Gründungsjahr der Firma Acme');
    const prompt = promptText(model);
    expect(prompt).toContain('German (de)');
    expect(prompt).toContain('When was that?');
    expect(prompt).toContain('Jane Doe founded Acme');
  });

  it('falls back to the question when the model returns nothing usable', async () => {
    const model = textModel('   ');
    await expect(
      rewriteQuery({
        model,
        language: 'en',
        history: [{ role: 'user', content: 'a' }],
        question: 'b?',
      }),
    ).resolves.toBe('b?');
  });
});

const chunk = (id: string, tokens: number): RankedChunk => ({
  id,
  source_id: 's',
  content: id,
  page_start: null,
  heading_path: null,
  token_count: tokens,
});

describe('selectContext', () => {
  it('numbers chunks in rank order within the token budget', () => {
    const result = selectContext([chunk('a', 3000), chunk('b', 3000), chunk('c', 3000)], 8000);
    expect(result.map((entry) => [entry.marker, entry.chunk.id])).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  it('always keeps the best chunk', () => {
    expect(selectContext([chunk('big', 9000)], 8000)).toHaveLength(1);
    expect(selectContext([], 8000)).toEqual([]);
  });

  it('counts tokens when the row has no count', () => {
    const result = selectContext([{ ...chunk('x', 0), token_count: null, content: 'hello' }], 10);
    expect(result).toHaveLength(1);
  });
});

describe('groundedAnswerInstructions', () => {
  it('names the notebook language and numbers the excerpts', () => {
    const instructions = groundedAnswerInstructions('en', [
      { marker: 1, sourceTitle: 'Paper', page: 3, headingPath: ['Intro'], content: 'Fact A.' },
      { marker: 2, sourceTitle: 'Notes', page: null, headingPath: [], content: 'Fact B.' },
    ]);
    expect(instructions).toContain('English (en)');
    expect(instructions).toContain('[1] Source: "Paper", page 3, section: Intro\nFact A.');
    expect(instructions).toContain('[2] Source: "Notes"\nFact B.');
  });

  it('states when there are no excerpts', () => {
    expect(formatExcerpts([])).toMatch(/no excerpts/);
  });
});

describe('streamGroundedAnswer', () => {
  it('streams an answer and strips old markers from the history', async () => {
    const model = streamModel(['Fact A ', '[1].']);
    const result = streamGroundedAnswer({
      model,
      language: 'de',
      excerpts: [{ marker: 1, sourceTitle: 'P', page: null, headingPath: [], content: 'A' }],
      history: [
        { role: 'user', content: 'First?' },
        { role: 'assistant', content: 'Old answer [4][5].' },
      ],
      question: 'Second?',
    });
    await expect(result.text).resolves.toBe('Fact A [1].');
    const prompt = promptText(model);
    expect(prompt).toContain('German (de)');
    expect(prompt).toContain('Old answer.');
    expect(prompt).not.toContain('[4]');
    expect(prompt).toContain('Second?');
  });
});

describe('chat titles', () => {
  it('generates a title in the notebook language', async () => {
    const model = textModel('"Wasser und Siedepunkt."');
    await expect(
      generateChatTitle({ model, language: 'de', question: 'q', answer: 'a [1]' }),
    ).resolves.toBe('Wasser und Siedepunkt');
    expect(promptText(model)).toContain('German (de)');
  });

  it('cleans model output', () => {
    expect(cleanTitle('Title: **Boiling water** [1]\nmore')).toBe('Boiling water');
    expect(cleanTitle('  \n ')).toBeNull();
    const long = cleanTitle('word '.repeat(40));
    expect(long?.endsWith('…')).toBe(true);
    expect(long?.length).toBeLessThanOrEqual(80);
  });
});
