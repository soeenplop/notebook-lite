import { describe, expect, it } from 'vitest';
import { formatDate, joinWithAnd, languageName, pluralize } from './format';

describe('format helpers', () => {
  it('pluralizes', () => {
    expect(pluralize(0, 'source')).toBe('0 sources');
    expect(pluralize(1, 'chat')).toBe('1 chat');
    expect(pluralize(2, 'podcast')).toBe('2 podcasts');
  });

  it('joins lists in prose', () => {
    expect(joinWithAnd([])).toBe('');
    expect(joinWithAnd(['a'])).toBe('a');
    expect(joinWithAnd(['a', 'b'])).toBe('a and b');
    expect(joinWithAnd(['a', 'b', 'c'])).toBe('a, b and c');
  });

  it('names languages and formats dates', () => {
    expect(languageName('de')).toBe('Deutsch');
    expect(formatDate('2026-11-12T21:00:00+00:00')).toBe('Nov 12, 2026');
  });
});
