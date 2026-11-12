import type { Metadata } from 'next';
import { NotebookOverview } from '@/components/notebooks/notebook-overview';

export const metadata: Metadata = { title: 'Notebooks · Notebook Lite' };

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <NotebookOverview />
    </main>
  );
}
