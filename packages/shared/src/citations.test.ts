import { describe, expect, it } from 'vitest';
import {
  extractCitationMarkers,
  findUncitedSentences,
  sanitizeCitations,
  splitCitations,
  toCitationQuote,
} from './citations.js';

describe('extractCitationMarkers', () => {
  it('reads single, adjacent and comma-separated markers in order of appearance', () => {
    expect(extractCitationMarkers('A [2]. B [1][3]. C [4, 2]. D [5,6].')).toEqual([
      2, 1, 3, 4, 5, 6,
    ]);
  });

  it('ignores text that only looks like a marker', () => {
    expect(extractCitationMarkers('arr[i] [a] [] [0] [1.5] [ 1 ]')).toEqual([]);
  });
});

describe('splitCitations', () => {
  it('splits text and groups adjacent markers', () => {
    expect(splitCitations('Water boils at 100 °C [1][2]. Ice melts [3, 1].')).toEqual([
      { type: 'text', text: 'Water boils at 100 °C ' },
      { type: 'citation', markers: [1, 2] },
      { type: 'text', text: '. Ice melts ' },
      { type: 'citation', markers: [3, 1] },
      { type: 'text', text: '.' },
    ]);
  });

  it('merges markers separated by whitespace only', () => {
    expect(splitCitations('Fact [1] [2].')).toEqual([
      { type: 'text', text: 'Fact ' },
      { type: 'citation', markers: [1, 2] },
      { type: 'text', text: '.' },
    ]);
  });

  it('drops invalid markers and the space before an emptied bracket', () => {
    const valid = new Set([1]);
    expect(splitCitations('Fact [7]. Other [1, 9].', valid)).toEqual([
      { type: 'text', text: 'Fact. Other ' },
      { type: 'citation', markers: [1] },
      { type: 'text', text: '.' },
    ]);
  });

  it('returns plain text unchanged', () => {
    expect(splitCitations('No markers here.')).toEqual([
      { type: 'text', text: 'No markers here.' },
    ]);
    expect(splitCitations('')).toEqual([]);
  });
});

describe('sanitizeCitations', () => {
  it('keeps valid markers, normalizes groups and removes unknown ones', () => {
    expect(sanitizeCitations('A [1, 2]. B [5]. C [2][9].', new Set([1, 2]))).toBe(
      'A [1][2]. B. C [2].',
    );
  });
});

describe('findUncitedSentences', () => {
  it('returns sentences without markers', () => {
    const text =
      'The study covered 300 participants [1]. Results were significant overall. ' +
      'The effect lasted two years. [2]';
    expect(findUncitedSentences(text)).toEqual(['Results were significant overall.']);
  });

  it('ignores headings, list intros and short fragments', () => {
    const text = '## Summary\nThe key findings are:\n- Growth was strong in 2025 [1].\n- Yes.';
    expect(findUncitedSentences(text)).toEqual([]);
  });
});

describe('toCitationQuote', () => {
  it('collapses whitespace and shortens long text at a word boundary', () => {
    expect(toCitationQuote('  a\n\nb  ')).toBe('a b');
    const quote = toCitationQuote('word '.repeat(200), 50);
    expect(quote.length).toBeLessThanOrEqual(50);
    expect(quote.endsWith('word…')).toBe(true);
  });
});
