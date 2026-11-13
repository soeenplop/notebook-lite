import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ChatView } from '@/components/chats/chat-view';

export const metadata: Metadata = { title: 'Chat · Notebook Lite' };

async function Chat({
  params,
}: Pick<PageProps<'/notebooks/[notebookId]/chats/[chatId]'>, 'params'>) {
  const { notebookId, chatId } = await params;
  return <ChatView notebookId={notebookId} chatId={chatId} />;
}

export default function ChatPage({ params }: PageProps<'/notebooks/[notebookId]/chats/[chatId]'>) {
  return (
    <Suspense>
      <Chat params={params} />
    </Suspense>
  );
}
