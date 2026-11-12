import { describe, expect, it } from 'vitest';
import { describeContents } from './delete-notebook-dialog';

describe('describeContents', () => {
  it('lists only non-empty item types', () => {
    expect(describeContents({ sources: 3, chats: 1, podcasts: 0 })).toBe('3 sources and 1 chat');
    expect(describeContents({ sources: 1, chats: 2, podcasts: 1 })).toBe(
      '1 source, 2 chats and 1 podcast',
    );
  });

  it('returns null for an empty notebook', () => {
    expect(describeContents({ sources: 0, chats: 0, podcasts: 0 })).toBeNull();
  });
});
