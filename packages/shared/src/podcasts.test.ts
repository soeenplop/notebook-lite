import { describe, expect, it } from 'vitest';
import {
  createPodcastInputSchema,
  isActivePodcastStatus,
  podcastAudioPath,
  podcastBatchPath,
  podcastScriptSchema,
  podcastTopicSuggestionsSchema,
  podcastWordTarget,
  stripAudioTags,
  suggestPodcastTopicsInputSchema,
} from './podcasts.js';

const notebookId = '7f0c3a52-3b7e-4c1e-9d2a-5d2f1c0b9e11';
const sourceId = '0b6f2f7e-8a8e-4d4b-9a51-2c3d4e5f6a7b';

describe('podcast contracts', () => {
  it('computes word targets from the language speaking rate', () => {
    expect(podcastWordTarget('en', 2)).toBe(300);
    expect(podcastWordTarget('en', 6)).toBe(900);
    expect(podcastWordTarget('en', 15)).toBe(2250);
    expect(podcastWordTarget('de', 6)).toBe(780);
  });

  it('validates and normalizes create input', () => {
    const parsed = createPodcastInputSchema.parse({
      notebookId,
      sourceIds: [sourceId, sourceId],
      mode: 'dialogue',
      targetMinutes: 6,
      topic: '  Climate policy  ',
    });
    expect(parsed.sourceIds).toEqual([sourceId]);
    expect(parsed.topic).toBe('Climate policy');

    const base = { notebookId, sourceIds: [sourceId], mode: 'dialogue', targetMinutes: 6 };
    expect(createPodcastInputSchema.safeParse({ ...base, topic: ' ' }).success).toBe(false);
    expect(
      createPodcastInputSchema.safeParse({ ...base, topic: 'x', targetMinutes: 5 }).success,
    ).toBe(false);
    expect(createPodcastInputSchema.safeParse({ ...base, topic: 'x', sourceIds: [] }).success).toBe(
      false,
    );
    expect(createPodcastInputSchema.safeParse({ ...base, topic: 'x', mode: 'trio' }).success).toBe(
      false,
    );
  });

  it('requires at least one source for suggestions', () => {
    expect(suggestPodcastTopicsInputSchema.safeParse({ notebookId, sourceIds: [] }).success).toBe(
      false,
    );
  });

  it('requires exactly three topic suggestions', () => {
    const topic = { title: 't', angle: 'a' };
    expect(podcastTopicSuggestionsSchema.safeParse({ topics: [topic, topic] }).success).toBe(false);
    expect(podcastTopicSuggestionsSchema.safeParse({ topics: [topic, topic, topic] }).success).toBe(
      true,
    );
  });

  it('validates scripts', () => {
    expect(
      podcastScriptSchema.safeParse({ title: 'T', segments: [{ speaker: 'A', text: 'Hi' }] })
        .success,
    ).toBe(true);
    expect(
      podcastScriptSchema.safeParse({ title: 'T', segments: [{ speaker: 'C', text: 'Hi' }] })
        .success,
    ).toBe(false);
  });

  it('builds storage paths under the owner folder', () => {
    expect(podcastAudioPath('u', 'n', 'p')).toBe('u/n/p/podcast.mp3');
    expect(podcastBatchPath('u', 'n', 'p', 2)).toBe('u/n/p/batch-2.mp3');
  });

  it('knows which statuses are still in progress', () => {
    expect(isActivePodcastStatus('queued')).toBe(true);
    expect(isActivePodcastStatus('synthesizing')).toBe(true);
    expect(isActivePodcastStatus('ready')).toBe(false);
    expect(isActivePodcastStatus('failed')).toBe(false);
  });
});

describe('stripAudioTags', () => {
  it('removes audio tags and keeps the spoken text', () => {
    expect(stripAudioTags('[laughs] Really? [curious] Tell me more.')).toBe(
      'Really? Tell me more.',
    );
    expect(stripAudioTags('No tags here.')).toBe('No tags here.');
  });
});
