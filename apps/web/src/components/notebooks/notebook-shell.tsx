'use client';

import { notebookIdSchema } from '@notebook-lite/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftIcon, MicIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentType, ReactNode } from 'react';
import { ChatsPanel } from '@/components/chats/chats-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { languageName, pluralize } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/react';
import { SourcesPanel } from '../sources/sources-panel';
import { NotebookActions } from './notebook-actions';

/**
 * Notebook workspace: header, sources panel (M3), chats (M4) and a link to the podcasts page
 * (M5).
 */
export function NotebookShell({ notebookId }: { notebookId: string }) {
  const trpc = useTRPC();
  const router = useRouter();
  const validId = notebookIdSchema.safeParse(notebookId).success;
  const notebook = useQuery({
    ...trpc.notebooks.get.queryOptions({ id: notebookId }),
    enabled: validId,
    retry: (failureCount, error) => error.data?.code !== 'NOT_FOUND' && failureCount < 1,
  });

  if (!validId || notebook.error?.data?.code === 'NOT_FOUND') return <NotebookNotFound />;
  if (notebook.isError) {
    return (
      <Frame>
        <p role="alert" className="text-sm text-destructive">
          Could not load notebook: {notebook.error.message}
        </p>
      </Frame>
    );
  }
  if (notebook.isPending) {
    return (
      <Frame>
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      </Frame>
    );
  }

  const { data } = notebook;
  return (
    <Frame>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{data.name}</h1>
            <Badge variant="secondary">{languageName(data.language)}</Badge>
          </div>
          {data.description && (
            <p className="max-w-prose text-sm whitespace-pre-line text-muted-foreground">
              {data.description}
            </p>
          )}
        </div>
        <NotebookActions notebook={data} onDeleted={() => router.replace('/')} />
      </header>

      <SourcesPanel notebookId={data.id} />

      <div className="grid gap-4 md:grid-cols-2">
        <ChatsPanel notebookId={data.id} />
        <Section
          icon={MicIcon}
          title="Podcasts"
          count={pluralize(data.counts.podcasts, 'podcast')}
          href={`/notebooks/${notebookId}/podcasts`}
          linkLabel="Open podcasts"
        >
          Turn sources into a monologue or a two-person dialogue.
        </Section>
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        All notebooks
      </Link>
      {children}
    </main>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  href,
  linkLabel,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  count: string;
  /** Page of the section; sections without one are not built yet. */
  href?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid content-start gap-2 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </h2>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
      {href ? (
        <div>
          <Button render={<Link href={href} />} variant="outline" size="sm">
            {linkLabel ?? `Open ${title.toLowerCase()}`}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Coming soon.</p>
      )}
    </section>
  );
}

function NotebookNotFound() {
  return (
    <Frame>
      <div className="grid gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
        <h1 className="text-lg font-medium">Notebook not found</h1>
        <p className="text-sm text-muted-foreground">
          It may have been deleted, or the link is wrong.
        </p>
        <div>
          <Button render={<Link href="/" />} variant="outline">
            Back to notebooks
          </Button>
        </div>
      </div>
    </Frame>
  );
}
