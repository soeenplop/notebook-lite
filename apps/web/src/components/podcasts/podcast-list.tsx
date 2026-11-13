'use client';

import {
  isActivePodcastStatus,
  notebookIdSchema,
  type PodcastSummary,
} from '@notebook-lite/shared';
import { useQuery } from '@tanstack/react-query';
import { LoaderCircleIcon, MicIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, languageName } from '@/lib/format';
import { formatDuration, modeLabel, PODCAST_STATUS_LABELS, pollInterval } from '@/lib/podcasts';
import { useTRPC } from '@/lib/trpc/react';
import { NewPodcastDialog } from './new-podcast-dialog';
import { PodcastFrame, PodcastNotFound } from './podcast-frame';

/** Podcasts of a notebook with a "New podcast" wizard; polls while one is in production. */
export function PodcastList({ notebookId }: { notebookId: string }) {
  const trpc = useTRPC();
  const [wizardOpen, setWizardOpen] = useState(false);
  const validId = notebookIdSchema.safeParse(notebookId).success;
  const notebook = useQuery({
    ...trpc.notebooks.get.queryOptions({ id: notebookId }),
    enabled: validId,
    retry: (failureCount, error) => error.data?.code !== 'NOT_FOUND' && failureCount < 1,
  });
  const podcasts = useQuery({
    ...trpc.podcasts.list.queryOptions({ notebookId }),
    enabled: validId,
    refetchInterval: (query) => pollInterval(query.state.data?.map((podcast) => podcast.status)),
  });

  if (!validId || notebook.error?.data?.code === 'NOT_FOUND') {
    return <PodcastNotFound what="Notebook" backHref="/" backLabel="All notebooks" />;
  }

  return (
    <PodcastFrame
      backHref={`/notebooks/${notebookId}`}
      backLabel={notebook.data?.name ?? 'Notebook'}
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Podcasts</h1>
          <p className="text-sm text-muted-foreground">
            Audio episodes generated only from this notebook’s sources
            {notebook.data ? `, in ${languageName(notebook.data.language)}` : ''}.
          </p>
        </div>
        <Button onClick={() => setWizardOpen(true)}>
          <PlusIcon aria-hidden />
          New podcast
        </Button>
      </header>

      {podcasts.isPending && (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}
      {podcasts.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load podcasts: {podcasts.error.message}
        </p>
      )}
      {podcasts.data?.length === 0 && (
        <div className="grid justify-items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
          <MicIcon className="size-8 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-medium">No podcasts yet</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Pick sources, choose a monologue or a dialogue and a length, and get an episode that
            sticks to your material.
          </p>
          <Button variant="outline" onClick={() => setWizardOpen(true)}>
            Create your first podcast
          </Button>
        </div>
      )}
      {podcasts.data && podcasts.data.length > 0 && (
        <ul className="grid grid-cols-1 gap-3">
          {podcasts.data.map((podcast) => (
            <li key={podcast.id}>
              <PodcastRow notebookId={notebookId} podcast={podcast} />
            </li>
          ))}
        </ul>
      )}

      <NewPodcastDialog notebookId={notebookId} open={wizardOpen} onOpenChange={setWizardOpen} />
    </PodcastFrame>
  );
}

function PodcastRow({ notebookId, podcast }: { notebookId: string; podcast: PodcastSummary }) {
  const active = isActivePodcastStatus(podcast.status);
  return (
    <Link
      href={`/notebooks/${notebookId}/podcasts/${podcast.id}`}
      className="grid min-w-0 grid-cols-1 gap-1 rounded-xl border p-4 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="min-w-0 flex-1 truncate font-medium"
          title={podcast.title ?? podcast.topic}
        >
          {podcast.title ?? podcast.topic}
        </span>
        <PodcastStatusBadge status={podcast.status} />
      </div>
      <p className="text-xs text-muted-foreground">
        {modeLabel(podcast.mode)} · ~{podcast.targetMinutes} min
        {podcast.durationSeconds !== null
          ? ` · ${formatDuration(podcast.durationSeconds)}`
          : ''} · {formatDate(podcast.createdAt)}
      </p>
      {podcast.status === 'failed' && podcast.error && (
        <p className="text-sm break-words text-destructive">{podcast.error}</p>
      )}
      {active && (
        <p className="text-xs text-muted-foreground">
          This takes a few minutes. You can leave this page.
        </p>
      )}
    </Link>
  );
}

export function PodcastStatusBadge({ status }: { status: PodcastSummary['status'] }) {
  const active = isActivePodcastStatus(status);
  return (
    <Badge
      variant={status === 'failed' ? 'destructive' : status === 'ready' ? 'secondary' : 'outline'}
    >
      {active && <LoaderCircleIcon className="animate-spin" aria-hidden />}
      {PODCAST_STATUS_LABELS[status]}
    </Badge>
  );
}
