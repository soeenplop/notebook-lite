import { describe, expect, it } from 'vitest';
import {
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_TITLE_MAX_LENGTH,
  chatStreamRequestSchema,
  renameChatInputSchema,
  setChatSourcesInputSchema,
} from './chats.js';

const id = '7f4c1a52-2b8e-4a83-9d4e-0d6e5c3b2a10';
const sourceId = '0b0c6d1e-3f4a-4b5c-8d6e-7f8091a2b3c4';

describe('chat schemas', () => {
  it('trims titles and enforces the length limit', () => {
    expect(renameChatInputSchema.parse({ id, title: '  Notes ' }).title).toBe('Notes');
    expect(renameChatInputSchema.safeParse({ id, title: '   ' }).success).toBe(false);
    expect(
      renameChatInputSchema.safeParse({ id, title: 'x'.repeat(CHAT_TITLE_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it('deduplicates selected sources and allows an empty selection', () => {
    expect(setChatSourcesInputSchema.parse({ id, sourceIds: [sourceId, sourceId] })).toEqual({
      id,
      sourceIds: [sourceId],
    });
    expect(setChatSourcesInputSchema.parse({ id, sourceIds: [] }).sourceIds).toEqual([]);
    expect(setChatSourcesInputSchema.safeParse({ id, sourceIds: ['nope'] }).success).toBe(false);
  });

  it('validates stream requests', () => {
    expect(chatStreamRequestSchema.parse({ text: ' Hi? ' })).toEqual({ text: 'Hi?' });
    expect(chatStreamRequestSchema.safeParse({ text: ' ' }).success).toBe(false);
    expect(
      chatStreamRequestSchema.safeParse({ text: 'x'.repeat(CHAT_MESSAGE_MAX_LENGTH + 1) }).success,
    ).toBe(false);
  });
});
