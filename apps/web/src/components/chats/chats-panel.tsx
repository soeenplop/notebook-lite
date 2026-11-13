'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { chatTitle } from '@/lib/chat';
import { formatDate } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/react';
import { cn } from '@/lib/utils';
import { ChatActions } from './chat-actions';

/** Starts a new chat in the notebook (all ready sources preselected) and opens it. */
export function useCreateChat(notebookId: string) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation(
    trpc.chats.create.mutationOptions({
      onSuccess: async (chat) => {
        await Promise.all([
          queryClient.invalidateQueries(trpc.chats.list.queryFilter({ notebookId })),
          queryClient.invalidateQueries(trpc.notebooks.get.queryFilter({ id: notebookId })),
        ]);
        router.push(`/notebooks/${notebookId}/chats/${chat.id}`);
      },
      onError: (error) => toast.error(error.message),
    }),
  );
}

/** The notebook's chats with "New chat"; highlights `activeChatId`. */
export function ChatsPanel({
  notebookId,
  activeChatId,
  className,
}: {
  notebookId: string;
  activeChatId?: string;
  className?: string;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const chats = useQuery(trpc.chats.list.queryOptions({ notebookId }));
  const create = useCreateChat(notebookId);

  return (
    <section className={cn('grid content-start gap-3 rounded-xl border p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <MessageSquareIcon className="size-4 text-muted-foreground" />
          Chats
        </h2>
        <Button
          size="sm"
          variant="outline"
          disabled={create.isPending}
          onClick={() => create.mutate({ notebookId })}
        >
          <PlusIcon />
          New chat
        </Button>
      </div>

      {chats.isPending ? (
        <div className="grid gap-2" aria-busy="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : chats.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load chats: {chats.error.message}
        </p>
      ) : chats.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No chats yet. Start one to ask questions answered only from your sources, with citations.
        </p>
      ) : (
        <ul className="-mx-2 grid gap-0.5">
          {chats.data.map((chat) => (
            <li
              key={chat.id}
              className={cn(
                'flex items-center gap-1 rounded-lg pr-1 hover:bg-muted',
                chat.id === activeChatId && 'bg-muted',
              )}
            >
              <Link
                href={`/notebooks/${notebookId}/chats/${chat.id}`}
                aria-current={chat.id === activeChatId ? 'page' : undefined}
                className="grid min-w-0 flex-1 px-2 py-1.5 text-sm"
              >
                <span className={cn('truncate', !chat.title && 'text-muted-foreground')}>
                  {chatTitle(chat.title)}
                </span>
                <span className="text-xs text-muted-foreground">{formatDate(chat.updatedAt)}</span>
              </Link>
              <ChatActions
                chat={chat}
                onDeleted={
                  chat.id === activeChatId
                    ? () => router.replace(`/notebooks/${notebookId}`)
                    : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
