import type { ChatDataTypes, ChatMessage, Citation } from '@notebook-lite/shared';
import type { UIMessage } from 'ai';

/** UI message of a grounded chat: text parts plus the `data-citations` marker map. */
export type ChatUIMessage = UIMessage<unknown, ChatDataTypes>;

/** Display title of a chat (automatic titles arrive after the first exchange). */
export function chatTitle(title: string | null): string {
  return title ?? 'New chat';
}

/** Converts stored messages into UI messages, so history and live answers render the same. */
export function toUIMessages(messages: readonly ChatMessage[]): ChatUIMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [
      ...(message.role === 'assistant'
        ? [{ type: 'data-citations' as const, id: 'citations', data: message.citations }]
        : []),
      { type: 'text' as const, text: message.content },
    ],
  }));
}

/** The text of a UI message (all text parts joined). */
export function messageText(message: ChatUIMessage): string {
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim();
}

/** Citation map of an assistant message, keyed by marker. */
export function messageCitations(message: ChatUIMessage): Map<number, Citation> {
  const citations = new Map<number, Citation>();
  for (const part of message.parts) {
    if (part.type === 'data-citations') {
      for (const citation of part.data) citations.set(citation.marker, citation);
    }
  }
  return citations;
}

/**
 * User-facing message for a failed chat request. Errors before the stream starts carry the API's
 * JSON body (`{ error: { message } }` or Nest's `{ message }`) as their message.
 */
export function chatErrorMessage(error: Error | undefined): string | null {
  if (!error) return null;
  try {
    const body: unknown = JSON.parse(error.message);
    if (body && typeof body === 'object') {
      const nested = 'error' in body ? body.error : undefined;
      if (nested && typeof nested === 'object' && 'message' in nested) {
        if (typeof nested.message === 'string') return nested.message;
      }
      if ('message' in body && typeof body.message === 'string') return body.message;
    }
  } catch {
    // Not JSON: a stream error text or a network error.
  }
  return error.message || 'Something went wrong. Please try again.';
}
