'use client';

import {
  type ChatDetail,
  type Citation,
  chatIdSchema,
  notebookIdSchema,
} from '@notebook-lite/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { chatTitle } from '@/lib/chat';
import { useTRPC } from '@/lib/trpc/react';
import { ChatActions } from './chat-actions';
import { ChatThread } from './chat-thread';
import { ChatsPanel } from './chats-panel';
import { SourceSelector } from './source-selector';
import { SourceViewer } from './source-viewer';

/** `/notebooks/[notebookId]/chats/[chatId]`: source selector, thread and source viewer. */
export function ChatView({ notebookId, chatId }: { notebookId: string; chatId: string }) {
  const trpc = useTRPC();
  const validIds =
    notebookIdSchema.safeParse(notebookId).success && chatIdSchema.safeParse(chatId).success;
  const chat = useQuery({
    ...trpc.chats.get.queryOptions({ id: chatId }),
    enabled: validIds,
    retry: (failureCount, error) => error.data?.code !== 'NOT_FOUND' && failureCount < 1,
  });
  const notebook = useQuery({
    ...trpc.notebooks.get.queryOptions({ id: notebookId }),
    enabled: validIds,
  });

  const wrongNotebook = chat.data !== undefined && chat.data.notebookId !== notebookId;
  if (!validIds || chat.error?.data?.code === 'NOT_FOUND' || wrongNotebook) {
    return <ChatNotFound notebookId={validIds ? notebookId : null} />;
  }

  return (
    <Frame notebookId={notebookId} notebookName={notebook.data?.name}>
      {chat.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load chat: {chat.error.message}
        </p>
      ) : chat.isPending ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <LoadedChat key={chat.data.id} chat={chat.data} />
      )}
    </Frame>
  );
}

function LoadedChat({ chat }: { chat: ChatDetail }) {
  const router = useRouter();
  const [citation, setCitation] = useState<Citation | null>(null);
  const { selected, update, isSaving } = useSourceSelection(chat);
  const canSend = chat.sources.some(
    (source) => source.status === 'ready' && selected.has(source.id),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="grid content-start gap-4">
        <SourceSelector
          sources={chat.sources}
          selected={selected}
          onChange={update}
          disabled={isSaving}
        />
        <ChatsPanel notebookId={chat.notebookId} activeChatId={chat.id} className="max-lg:hidden" />
      </aside>
      <section className="flex min-w-0 flex-col gap-4">
        <header className="flex items-center justify-between gap-2">
          <h1
            className={`truncate text-xl font-semibold tracking-tight ${chat.title ? '' : 'text-muted-foreground'}`}
          >
            {chatTitle(chat.title)}
          </h1>
          <ChatActions
            chat={chat}
            onDeleted={() => router.replace(`/notebooks/${chat.notebookId}`)}
          />
        </header>
        <ChatThread chat={chat} canSend={canSend} onSelectCitation={setCitation} />
      </section>
      <SourceViewer citation={citation} onClose={() => setCitation(null)} />
    </div>
  );
}

/** Local selection state, saved through `chats.setSources` (reverted on failure). */
function useSourceSelection(chat: ChatDetail) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(
    () => new Set(chat.sources.filter((source) => source.selected).map((source) => source.id)),
  );
  const save = useMutation(
    trpc.chats.setSources.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.chats.get.queryFilter({ id: chat.id })),
      onError: (error, _input, context) => {
        toast.error(`Could not update sources: ${error.message}`);
        if (context instanceof Set) setSelected(context);
      },
      onMutate: () => new Set(selected),
    }),
  );
  return {
    selected,
    isSaving: save.isPending,
    update: (next: Set<string>) => {
      setSelected(next);
      save.mutate({ id: chat.id, sourceIds: [...next] });
    },
  };
}

function Frame({
  notebookId,
  notebookName,
  children,
}: {
  notebookId: string;
  notebookName?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <Link
        href={`/notebooks/${notebookId}`}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        {notebookName ?? 'Notebook'}
      </Link>
      {children}
    </main>
  );
}

function ChatNotFound({ notebookId }: { notebookId: string | null }) {
  const href = notebookId ? `/notebooks/${notebookId}` : '/';
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <div className="grid gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
        <h1 className="text-lg font-medium">Chat not found</h1>
        <p className="text-sm text-muted-foreground">
          It may have been deleted, or the link is wrong.
        </p>
        <div>
          <Button render={<Link href={href} />} variant="outline">
            {notebookId ? 'Back to notebook' : 'Back to notebooks'}
          </Button>
        </div>
      </div>
    </main>
  );
}
