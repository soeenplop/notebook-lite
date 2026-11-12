import { describe, expect, it } from 'vitest';
import { chatErrorMessage, chatTitle, messageCitations, messageText, toUIMessages } from './chat';

const citation = {
  marker: 1,
  chunkId: '5e4d3c2b-1a09-4f8e-8d7c-6b5a49382716',
  sourceId: '0b0c6d1e-3f4a-4b5c-8d6e-7f8091a2b3c4',
  sourceTitle: 'Paper',
  page: 3,
  quote: 'Water boils at 100 °C.',
};

describe('toUIMessages', () => {
  it('turns stored messages into UI messages with citation parts', () => {
    const [question, answer] = toUIMessages([
      {
        id: 'a0000000-0000-4000-8000-000000000001',
        role: 'user',
        content: 'When?',
        citations: [],
        createdAt: '2026-11-13T10:00:00+00:00',
      },
      {
        id: 'a0000000-0000-4000-8000-000000000002',
        role: 'assistant',
        content: 'At 100 °C [1].',
        citations: [citation],
        createdAt: '2026-11-13T10:00:01+00:00',
      },
    ]);
    expect(question?.parts).toEqual([{ type: 'text', text: 'When?' }]);
    expect(answer && messageText(answer)).toBe('At 100 °C [1].');
    expect(answer && messageCitations(answer).get(1)).toEqual(citation);
  });
});

describe('chatErrorMessage', () => {
  it('reads API error bodies', () => {
    expect(
      chatErrorMessage(
        new Error(JSON.stringify({ error: { code: 'NO_SOURCES_SELECTED', message: 'Pick one.' } })),
      ),
    ).toBe('Pick one.');
    expect(chatErrorMessage(new Error(JSON.stringify({ message: 'Chat not found' })))).toBe(
      'Chat not found',
    );
    expect(chatErrorMessage(new Error('Network down'))).toBe('Network down');
    expect(chatErrorMessage(undefined)).toBeNull();
  });
});

describe('chatTitle', () => {
  it('falls back for untitled chats', () => {
    expect(chatTitle(null)).toBe('New chat');
    expect(chatTitle('Boiling')).toBe('Boiling');
  });
});
