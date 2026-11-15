'use client';

import type { PodcastChangeEvent } from '@notebook-lite/shared';
import { useSubscription } from '@trpc/tanstack-react-query';
import { useTRPC } from '@/lib/trpc/react';

/**
 * Live podcast changes of a notebook over SSE (`podcasts.onChange`). `onStarted` runs on every
 * (re)connect, so callers can catch up on changes made while the stream was down.
 */
export function usePodcastChanges(
  notebookId: string,
  handlers: {
    enabled?: boolean;
    onStarted?: () => void;
    onEvent: (event: PodcastChangeEvent) => void;
  },
): void {
  const trpc = useTRPC();
  useSubscription(
    trpc.podcasts.onChange.subscriptionOptions(
      { notebookId },
      {
        enabled: handlers.enabled ?? true,
        onStarted: handlers.onStarted,
        onData: handlers.onEvent,
      },
    ),
  );
}
