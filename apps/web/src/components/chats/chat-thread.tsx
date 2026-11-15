'use client';

import { useChat } from '@ai-sdk/react';
import { CHAT_MESSAGE_MAX_LENGTH, type ChatDetail, type Citation } from '@notebook-lite/shared';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport } from 'ai';
import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  type ChatUIMessage,
  chatErrorMessage,
  messageCitations,
  messageText,
  toUIMessages,
} from '@/lib/chat';
import { publicEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/client';
import { useTRPC } from '@/lib/trpc/react';
import { cn } from '@/lib/utils';
import { CitationText } from './citation-text';

/** Transport for `POST /chat/:chatId/stream`: sends only the new question with the user's JWT. */
function useChatTransport(chatId: string) {
  return useMemo(() => {
    const supabase = createClient();
    return new DefaultChatTransport<ChatUIMessage>({
      api: `${publicEnv().NEXT_PUBLIC_API_URL}/chat/${chatId}/stream`,
      prepareSendMessagesRequest: async ({ messages }) => {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const last = messages.at(-1);
        return {
          headers,
          body: { text: last ? messageText(last) : '' },
        };
      },
    });
  }, [chatId]);
}

/**
 * Message thread with streaming answers (AI SDK `useChat`). Mount it with `key={chat.id}`:
 * the stored messages only seed the conversation.
 */
export function ChatThread({
  chat,
  canSend,
  onSelectCitation,
}: {
  chat: ChatDetail;
  /** False while no ready source is selected. */
  canSend: boolean;
  onSelectCitation: (citation: Citation) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const transport = useChatTransport(chat.id);
  const [initialMessages] = useState(() => toUIMessages(chat.messages));
  const { messages, sendMessage, status, stop, error, clearError } = useChat<ChatUIMessage>({
    id: chat.id,
    messages: initialMessages,
    transport,
    throttle: 50,
    onData: (part) => {
      if (part.type === 'data-chat-title') {
        void queryClient.invalidateQueries(trpc.chats.get.queryFilter({ id: chat.id }));
      }
    },
    onFinish: () => {
      // The chat moved to the top of the list (and may have a new title).
      void queryClient.invalidateQueries(
        trpc.chats.list.queryFilter({ notebookId: chat.notebookId }),
      );
    },
  });

  const [input, setInput] = useState('');
  const busy = status === 'submitted' || status === 'streaming';
  const endRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages.at(-1);

  // Follow the streaming answer, unless the user scrolled up to read.
  useEffect(() => {
    const end = endRef.current;
    if (!end) return;
    const distance = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
    if (distance < 240) end.scrollIntoView({ block: 'end' });
  });

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || busy || !canSend) return;
    clearError();
    setInput('');
    void sendMessage({ text });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  const errorMessage = chatErrorMessage(error);
  const waitingForText =
    busy && (lastMessage?.role !== 'assistant' || messageText(lastMessage) === '');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex min-h-64 flex-1 flex-col gap-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="grid flex-1 place-content-center gap-1 rounded-xl border border-dashed px-6 py-12 text-center">
            <p className="font-medium">Ask anything about your sources</p>
            <p className="text-sm text-muted-foreground">
              Answers use only the selected sources and cite every statement.
            </p>
          </div>
        )}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            streaming={status === 'streaming' && message.id === lastMessage?.id}
            onSelectCitation={onSelectCitation}
          />
        ))}
        {waitingForText && (
          <p className="animate-pulse text-sm text-muted-foreground">Searching your sources…</p>
        )}
        {errorMessage && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {errorMessage}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="sticky bottom-0 grid gap-1 bg-background pb-4">
        <div className="flex items-end gap-2 rounded-xl border p-2 focus-within:ring-2 focus-within:ring-ring/50">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={canSend ? 'Ask a question…' : 'Select at least one ready source first'}
            aria-label="Your question"
            maxLength={CHAT_MESSAGE_MAX_LENGTH}
            rows={2}
            disabled={!canSend}
            className="max-h-48 min-h-10 resize-none border-0 shadow-none focus-visible:ring-0"
          />
          {busy ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => void stop()}
              aria-label="Stop"
            >
              <SquareIcon />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!canSend || !input.trim()}
              aria-label="Send"
            >
              <ArrowUpIcon />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Enter to send, Shift+Enter for a new line. Answers come only from the selected sources.
        </p>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  streaming,
  onSelectCitation,
}: {
  message: ChatUIMessage;
  /** True while this answer is still streaming in. */
  streaming: boolean;
  onSelectCitation: (citation: Citation) => void;
}) {
  const text = messageText(message);
  const citations = useMemo(() => messageCitations(message), [message]);
  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl bg-muted px-4 py-2 text-sm whitespace-pre-wrap">
        {text}
      </div>
    );
  }
  if (!text) return null;
  return (
    <div className={cn('max-w-full')}>
      <CitationText
        text={text}
        citations={citations}
        isAnimating={streaming}
        onSelect={onSelectCitation}
      />
    </div>
  );
}
