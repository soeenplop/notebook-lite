import type { LanguageModelV4CallOptions, LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import {
  cleanSpokenText,
  countScriptWords,
  generatePodcastScript,
  OUTLINE_SECTION_COUNT,
  streamPodcastTopics,
  TOPIC_REASONING_EFFORT,
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

/** A mock model that streams `text` in small deltas, like a structured-output response. */
function streamingModel(text: string) {
  const deltas = text.match(/.{1,12}/gs) ?? [];
  return new MockLanguageModelV4({
    doStream: () =>
      Promise.resolve({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 't' },
            ...deltas.map((delta) => ({ type: 'text-delta' as const, id: 't', delta })),
            { type: 'text-end', id: 't' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: jsonResult(null).usage,
            },
          ],
        }),
      }),
  });
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

describe('streamPodcastTopics', () => {
  const topics = [
    { title: 'Solar **boom**', angle: 'Why capacity doubled [1].' },
    { title: 'Cheaper storage', angle: 'What falling costs change.' },
    { title: 'Grid limits', angle: 'Where the bottlenecks are.' },
  ];

  it('streams three cleaned topics with low reasoning effort, in the notebook language', async () => {
    const model = streamingModel(JSON.stringify({ elements: topics }));
    const result = await collect(streamPodcastTopics(model, { language: 'de', excerpts }));
    expect(result).toEqual([
      { title: 'Solar boom', angle: 'Why capacity doubled.' },
      topics[1],
      topics[2],
    ]);
    const call = model.doStreamCalls[0];
    expect(call?.providerOptions).toEqual({ openai: { reasoningEffort: TOPIC_REASONING_EFFORT } });
    const prompt = promptText(call);
    expect(prompt).toContain('German (Deutsch)');
    expect(prompt).toContain('Storage costs fell by 40 percent.');
    expect(prompt).toContain('source=\\"Report \'2026\'\\"');
  });

  it('can be consumed one topic at a time', async () => {
    const model = streamingModel(JSON.stringify({ elements: topics }));
    const stream = streamPodcastTopics(model, { language: 'en', excerpts });
    const first = await stream.next();
    expect(first.value).toEqual({ title: 'Solar boom', angle: 'Why capacity doubled.' });
    await stream.return();
  });

  it('stops after three topics', async () => {
    const model = streamingModel(JSON.stringify({ elements: [...topics, topics[1]] }));
    const result = await collect(streamPodcastTopics(model, { language: 'en', excerpts }));
    expect(result).toHaveLength(3);
  });

  it('fails when the model suggests nothing', async () => {
    const model = streamingModel(JSON.stringify({ elements: [] }));
    await expect(
      collect(streamPodcastTopics(model, { language: 'en', excerpts, maxRetries: 0 })),
    ).rejects.toThrow(/no topics/);
  });

  it('surfaces model errors', async () => {
    const model = new MockLanguageModelV4({
      doStream: () => Promise.reject(new Error('model down')),
    });
    await expect(
      collect(streamPodcastTopics(model, { language: 'en', excerpts, maxRetries: 0 })),
    ).rejects.toThrow(/model down/);
  });

  it('needs excerpts', async () => {
    await expect(
      collect(streamPodcastTopics(streamingModel(''), { language: 'en', excerpts: [] })),
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

  it('keeps allowed audio tags in segments but not in the title', async () => {
    const model = mockModel({
      title: '[excited] Solar Boom',
      segments: [
        { speaker: 'A', text: '[Laughs] Really? [surprised] That fast?' },
        { speaker: 'B', text: '[dramatic pause] Yes [1].' },
        { speaker: 'A', text: '[sighs]' },
      ],
    });
    const script = await generatePodcastScript(model, {
      language: 'en',
      mode: 'dialogue',
      targetMinutes: 2,
      topic: 'Solar',
      excerpts,
    });
    expect(script).toEqual({
      title: 'Solar Boom',
      segments: [
        { speaker: 'A', text: '[laughs] Really? That fast?' },
        { speaker: 'B', text: 'Yes.' },
      ],
    });
    expect(countScriptWords(script)).toBe(4);
  });

  it('asks for a hook, distinct hosts, audio tags and takeaways in the notebook language', async () => {
    const model = mockModel({ title: 'T', segments: [{ speaker: 'A', text: 'Hi.' }] });
    await generatePodcastScript(model, {
      language: 'de',
      mode: 'dialogue',
      targetMinutes: 6,
      topic: 'Solar',
      excerpts,
    });
    const prompt = promptText(model.doGenerateCalls[0]);
    expect(prompt).toContain('Open with a hook');
    expect(prompt).toContain('takeaways');
    expect(prompt).toContain('Host A is curious');
    expect(prompt).toContain('[laughs]');
    expect(prompt).toContain('ähm');
  });
});

describe('cleanSpokenText', () => {
  it('strips markers, markdown and speaker labels', () => {
    expect(cleanSpokenText('B: This is *really* `big` [1][2-3].')).toBe('This is really big.');
    expect(cleanSpokenText('# Heading\n- item one\n- item two')).toBe('Heading item one item two');
    expect(cleanSpokenText('2 * 3 is 6')).toBe('2 * 3 is 6');
  });

  it('removes bracketed text and keeps only the first allowed audio tag on request', () => {
    expect(cleanSpokenText('[laughs] Fair point [sic].')).toBe('Fair point.');
    expect(cleanSpokenText('[laughs] Fair [curious] point.', { keepAudioTags: true })).toBe(
      '[laughs] Fair point.',
    );
    expect(cleanSpokenText('[whispers] Psst.', { keepAudioTags: true })).toBe('Psst.');
  });
});
