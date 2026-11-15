import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PodcastView } from '@/components/podcasts/podcast-view';

export const metadata: Metadata = { title: 'Podcast · Notebook Lite' };

async function Podcast({
  params,
}: Pick<PageProps<'/notebooks/[notebookId]/podcasts/[podcastId]'>, 'params'>) {
  const { notebookId, podcastId } = await params;
  return <PodcastView notebookId={notebookId} podcastId={podcastId} />;
}

export default function PodcastPage({
  params,
}: PageProps<'/notebooks/[notebookId]/podcasts/[podcastId]'>) {
  return (
    <Suspense>
      <Podcast params={params} />
    </Suspense>
  );
}
