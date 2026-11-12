import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import {
  cleanSpokenText,
  countScriptWords,
  generatePodcastScript,
  OUTLINE_SECTION_COUNT,
  suggestPodcastTopics,
} from './podcasts.js';

const excerpts = [
  { sourceTitle: 'Report "2026"', content: 'Solar capacity doubled in 2025.' },
  { sourceTitle: 'Notes', content: 'Storage costs fell by 40 percent.' },
];

function jsonResult(value: unknown): LanguageModelV4GenerateResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 10, text: 10, reasoning: 0 },
    },
    warnings: [],
  };
}

/** A mock model that answers each call with the next queued JSON value. */
function mockModel(...responses: unknown[]) {
  let next = 0;
  return new MockLanguageModelV4({
    doGenerate: () => {
      const response = responses[next++];
      if (response === undefined) throw new Error('unexpected model call');
      return Promise.resolve(jsonResult(response));
    },
  });
}

function promptText(call: LanguageModelV4CallOptions | undefined): string {
  return JSON.stringify(call?.prompt ?? []);
}

describe('suggestPodcastTopics', () => {
  const topics = [
    { title: 'Solar **boom**', angle: 'Why capacity doubled [1].' },
    { title: 'Cheaper storage', angle: 'What falling costs change.' },
    { title: 'Grid limits', angle: 'Where the bottlenecks are.' },
  ];

  it('returns three cleaned topics and asks for the notebook language', async () => {
    const model = mockModel({ topics });
    const result = await suggestPodcastTopics(model, { language: 'de', excerpts });
    expect(result).toEqual([
      { title: 'Solar boom', angle: 'Why capacity doubled.' },
      topics[1],
      topics[2],
    ]);
    const prompt = promptText(model.doGenerateCalls[0]);
    expect(prompt).toContain('German (Deutsch)');
    expect(prompt).toContain('Storage costs fell by 40 percent.');
    expect(prompt).toContain('source=\\"Report \'2026\'\\"');
  });

  it('rejects an answer without exactly three topics', async () => {
    const model = mockModel({ topics: topics.slice(0, 2) });
    await expect(
      suggestPodcastTopics(model, { language: 'en', excerpts, maxRetries: 0 }),
    ).rejects.toThrow(/No object generated|did not match schema/i);
  });

  it('needs excerpts', async () => {
    await expect(
      suggestPodcastTopics(mockModel(), { language: 'en', excerpts: [] }),
    ).rejects.toThrow(/no excerpts/);
  });
});

describe('generatePodcastScript', () => {
  it('writes a short dialogue in one call with the word target and language', async () => {
    const model = mockModel({
      title: '## Solar Boom',
      segments: [
        { speaker: 'A', text: 'Welcome! Solar doubled [1].' },
        { speaker: 'B', text: 'And storage got **cheaper** [2, 3].' },
        { speaker: 'B', text: 'By forty percent.' },
        { speaker: 'A', text: '  ' },
      ],
    });
    const script = await generatePodcastScript(model, {
      language: 'en',
      mode: 'dialogue',
      targetMinutes: 6,
      topic: 'Energy transition',
      excerpts,
    });

    expect(model.doGenerateCalls).toHaveLength(1);
    const prompt = promptText(model.doGenerateCalls[0]);
    expect(prompt).toContain('about 900 words');
    expect(prompt).toContain('English (English)');
    expect(prompt).toContain('Energy transition');
    expect(script).toEqual({
      title: 'Solar Boom',
      segments: [
        { speaker: 'A', text: 'Welcome! Solar doubled.' },
        { speaker: 'B', text: 'And storage got cheaper. By forty percent.' },
      ],
    });
  });

  it('uses only speaker A for monologues', async () => {
    const model = mockModel({
      title: 'Solo',
      segments: [
        { speaker: 'A', text: 'One.' },
        { speaker: 'B', text: 'Two.' },
      ],
    });
    const script = await generatePodcastScript(model, {
      language: 'de',
      mode: 'monologue',
      targetMinutes: 2,
      topic: 'Solar',
      excerpts,
    });
    expect(script.segments).toEqual([{ speaker: 'A', text: 'One. Two.' }]);
    const prompt = promptText(model.doGenerateCalls[0]);
    expect(prompt).toContain('about 260 words');
    expect(prompt).toContain('German (Deutsch)');
    expect(prompt).toContain('single host');
  });

  it('writes 15-minute episodes from an outline, section by section', async () => {
    const sections = Array.from({ length: OUTLINE_SECTION_COUNT }, (_, i) => ({
      heading: `Part ${i + 1}`,
      points: [`point ${i + 1}`],
    }));
    const model = mockModel(
      { title: 'Long episode', sections },
      ...sections.map((_, i) => ({
        segments: [
          { speaker: 'A', text: `Question ${i + 1}?` },
          { speaker: 'B', text: `Answer ${i + 1}.` },
        ],
      })),
    );
    const script = await generatePodcastScript(model, {
      language: 'en',
      mode: 'dialogue',
      targetMinutes: 15,
      topic: 'Energy',
      excerpts,
    });

    expect(model.doGenerateCalls).toHaveLength(1 + OUTLINE_SECTION_COUNT);
    expect(promptText(model.doGenerateCalls[0])).toContain('about 2250 words');
    const second = promptText(model.doGenerateCalls[1]);
    expect(second).toContain('Write section 1');
    expect(second).toContain('about 450 words');
    expect(second).toContain('the episode starts here');
    const third = promptText(model.doGenerateCalls[2]);
    expect(third).toContain('B: Answer 1.');
    expect(promptText(model.doGenerateCalls.at(-1))).toContain('This is the last section');

    expect(script.title).toBe('Long episode');
    expect(script.segments).toHaveLength(2 * OUTLINE_SECTION_COUNT);
    expect(countScriptWords(script)).toBe(4 * OUTLINE_SECTION_COUNT);
  });

  it('falls back to the topic as title', async () => {
    const model = mockModel({ title: '**', segments: [{ speaker: 'A', text: 'Hi.' }] });
    const script = await generatePodcastScript(model, {
      language: 'en',
      mode: 'monologue',
      targetMinutes: 2,
      topic: 'Solar',
      excerpts,
    });
    expect(script.title).toBe('Solar');
  });
});

describe('cleanSpokenText', () => {
  it('strips markers, markdown and speaker labels', () => {
    expect(cleanSpokenText('B: This is *really* `big` [1][2-3].')).toBe('This is really big.');
    expect(cleanSpokenText('# Heading\n- item one\n- item two')).toBe('Heading item one item two');
    expect(cleanSpokenText('2 * 3 is 6')).toBe('2 * 3 is 6');
  });
});
