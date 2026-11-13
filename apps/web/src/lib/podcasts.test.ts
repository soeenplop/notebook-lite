import { describe, expect, it } from 'vitest';
import { canContinue, formatDuration, speakerLabel } from './podcasts';

describe('podcast helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(42.4)).toBe('0:42');
    expect(formatDuration(365)).toBe('6:05');
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('labels speakers by mode', () => {
    expect(speakerLabel('A', 'monologue')).toBe('Host');
    expect(speakerLabel('B', 'dialogue')).toBe('Host B');
  });

  it('gates wizard steps', () => {
    expect(canContinue('sources', { sourceIds: [], topic: '' })).toBe(false);
    expect(canContinue('sources', { sourceIds: ['s'], topic: '' })).toBe(true);
    expect(canContinue('format', { sourceIds: ['s'], topic: '' })).toBe(true);
    expect(canContinue('topic', { sourceIds: ['s'], topic: '  ' })).toBe(false);
    expect(canContinue('topic', { sourceIds: ['s'], topic: 'Solar' })).toBe(true);
  });
});
