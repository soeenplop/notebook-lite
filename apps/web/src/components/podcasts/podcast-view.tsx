'use client';

import { isActivePodcastStatus, podcastIdSchema, stripAudioTags } from '@notebook-lite/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DownloadIcon, Trash2Icon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, languageName } from '@/lib/format';
import { formatDuration, modeLabel, pollInterval, speakerLabel } from '@/lib/podcasts';
import { useTRPC } from '@/lib/trpc/react';
import { PodcastFrame, PodcastNotFound } from './podcast-frame';
import { PodcastStatusBadge } from './podcast-list';

/** One podcast: status while in production, then player, download and transcript. */
export function PodcastView({ notebookId, podcastId }: { notebookId: string; podcastId: string }) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const listHref = `/notebooks/${notebookId}/podcasts`;
  const validId = podcastIdSchema.safeParse(podcastId).success;

  const podcast = useQuery({
    ...trpc.podcasts.get.queryOptions({ id: podcastId }),
    enabled: validId,
    retry: (failureCount, error) => error.data?.code !== 'NOT_FOUND' && failureCount < 1,
    refetchInterval: (query) => pollInterval(query.state.data ? [query.state.data.status] : []),
    // Every fetch signs new audio URLs; refetching would restart the player.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const remove = useMutation(
    trpc.podcasts.delete.mutationOptions({
      onSuccess: async () => {
        setConfirmDelete(false);
        queryClient.removeQueries(trpc.podcasts.get.queryFilter({ id: podcastId }));
        await queryClient.invalidateQueries(trpc.podcasts.list.queryFilter({ notebookId }));
        await queryClient.invalidateQueries(trpc.notebooks.get.queryFilter({ id: notebookId }));
        toast.success('Podcast deleted');
        router.replace(listHref);
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (!validId || podcast.error?.data?.code === 'NOT_FOUND') {
    return <PodcastNotFound what="Podcast" backHref={listHref} backLabel="All podcasts" />;
  }
  if (podcast.isError) {
    return (
      <PodcastFrame backHref={listHref} backLabel="All podcasts">
        <p role="alert" className="text-sm text-destructive">
          Could not load the podcast: {podcast.error.message}
        </p>
      </PodcastFrame>
    );
  }
  if (podcast.isPending) {
    return (
      <PodcastFrame backHref={listHref} backLabel="All podcasts">
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </PodcastFrame>
    );
  }

  const { data } = podcast;
  const active = isActivePodcastStatus(data.status);
  return (
    <PodcastFrame backHref={listHref} backLabel="All podcasts">
      <header className="grid min-w-0 grid-cols-1 gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight break-words">
            {data.title ?? data.topic}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            <PodcastStatusBadge status={data.status} />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete podcast"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2Icon />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {modeLabel(data.mode)} · ~{data.targetMinutes} min · {languageName(data.language)} ·{' '}
          {formatDate(data.createdAt)}
        </p>
        <p className="text-sm break-words">
          <span className="text-muted-foreground">Topic:</span> {data.topic}
        </p>
        {data.sources.length > 0 && (
          <p className="text-sm break-words">
            <span className="text-muted-foreground">Sources:</span>{' '}
            {data.sources.map((source) => source.title).join(', ')}
          </p>
        )}
      </header>

      {active && (
        <div className="rounded-xl border p-4 text-sm text-muted-foreground" aria-live="polite">
          {data.status === 'synthesizing'
            ? 'The script is ready and the audio is being recorded.'
            : 'The script is being written from your sources.'}{' '}
          This takes a few minutes; you can leave this page.
        </div>
      )}
      {data.status === 'failed' && (
        <div role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm">
          <p className="font-medium text-destructive">The podcast could not be created.</p>
          {data.error && <p className="text-muted-foreground">{data.error}</p>}
        </div>
      )}
      {data.status === 'ready' && data.audioUrl && (
        <section className="grid gap-3 rounded-xl border p-4" aria-label="Player">
          {/* Transcript below serves as the text alternative. */}
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls preload="metadata" src={data.audioUrl} className="w-full" />
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {data.durationSeconds !== null ? formatDuration(data.durationSeconds) : null}
            </span>
            {data.downloadUrl && (
              <a
                href={data.downloadUrl}
                download
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <DownloadIcon aria-hidden />
                Download MP3
              </a>
            )}
          </div>
        </section>
      )}

      {data.script && (
        <section className="grid grid-cols-1 gap-3" aria-labelledby="transcript-heading">
          <h2 id="transcript-heading" className="text-lg font-medium">
            Transcript
          </h2>
          <ol className="grid gap-3">
            {data.script.segments.map((segment, index) => (
              // The script is immutable once written, so the position is a stable key.
              // oxlint-disable-next-line react/no-array-index-key
              <li key={index} className="grid gap-0.5 text-sm break-words">
                <span className="text-xs font-medium text-muted-foreground">
                  {speakerLabel(segment.speaker, data.mode)}
                </span>
                <p className="leading-relaxed">{stripAudioTags(segment.text)}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this podcast?</AlertDialogTitle>
            <AlertDialogDescription>
              The audio and transcript are deleted permanently. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ id: podcastId })}
            >
              {remove.isPending ? 'Deleting…' : 'Delete podcast'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PodcastFrame>
  );
}
