import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PodcastList } from '@/components/podcasts/podcast-list';

export const metadata: Metadata = { title: 'Podcasts · Notebook Lite' };

async function Podcasts({ params }: Pick<PageProps<'/notebooks/[notebookId]/podcasts'>, 'params'>) {
  const { notebookId } = await params;
  return <PodcastList notebookId={notebookId} />;
}

export default function PodcastsPage({ params }: PageProps<'/notebooks/[notebookId]/podcasts'>) {
  return (
    <Suspense>
      <Podcasts params={params} />
    </Suspense>
  );
}
