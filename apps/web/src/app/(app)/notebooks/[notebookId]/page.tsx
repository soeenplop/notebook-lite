import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NotebookShell } from '@/components/notebooks/notebook-shell';

export const metadata: Metadata = { title: 'Notebook · Notebook Lite' };

async function Notebook({ params }: Pick<PageProps<'/notebooks/[notebookId]'>, 'params'>) {
  const { notebookId } = await params;
  return <NotebookShell notebookId={notebookId} />;
}

export default function NotebookPage({ params }: PageProps<'/notebooks/[notebookId]'>) {
  return (
    <Suspense>
      <Notebook params={params} />
    </Suspense>
  );
}
