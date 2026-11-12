'use client';

import type { NotebookSummary } from '@notebook-lite/shared';
import { useQuery } from '@tanstack/react-query';
import { NotebookIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, languageName, pluralize } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/react';
import { NotebookActions } from './notebook-actions';
import { NotebookFormDialog } from './notebook-form-dialog';

export function NotebookOverview() {
  const trpc = useTRPC();
  const router = useRouter();
  const notebooks = useQuery(trpc.notebooks.list.queryOptions());
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notebooks</h1>
          <p className="text-sm text-muted-foreground">
            Collect sources, chat with them and turn them into podcasts.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon />
          New notebook
        </Button>
      </div>

      {notebooks.isPending ? (
        <NotebookGridSkeleton />
      ) : notebooks.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load notebooks: {notebooks.error.message}
        </p>
      ) : notebooks.data.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notebooks.data.map((notebook) => (
            <li key={notebook.id}>
              <NotebookCard notebook={notebook} />
            </li>
          ))}
        </ul>
      )}

      <NotebookFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(notebook) => router.push(`/notebooks/${notebook.id}`)}
      />
    </div>
  );
}

function NotebookCard({ notebook }: { notebook: NotebookSummary }) {
  const { counts } = notebook;
  return (
    <Card className="relative h-full transition-shadow hover:ring-foreground/20">
      <CardHeader>
        <CardTitle className="line-clamp-2">
          <Link
            href={`/notebooks/${notebook.id}`}
            className="outline-none after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:underline"
          >
            {notebook.name}
          </Link>
        </CardTitle>
        <CardDescription className="line-clamp-2 min-h-[2lh]">
          {notebook.description ?? 'No description'}
        </CardDescription>
        {/* Above the stretched link so the menu stays clickable. */}
        <CardAction className="relative z-10">
          <NotebookActions notebook={notebook} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{pluralize(counts.sources, 'source')}</span>
        <span>{pluralize(counts.chats, 'chat')}</span>
        <span>{pluralize(counts.podcasts, 'podcast')}</span>
      </CardContent>
      <CardFooter className="justify-between text-xs text-muted-foreground">
        <Badge variant="secondary">{languageName(notebook.language)}</Badge>
        <span>Updated {formatDate(notebook.updatedAt)}</span>
      </CardFooter>
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <NotebookIcon className="size-8 text-muted-foreground" aria-hidden />
      <h2 className="font-medium">No notebooks yet</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        A notebook groups the sources you want to chat with or turn into a podcast.
      </p>
      <Button onClick={onCreate}>
        <PlusIcon />
        Create your first notebook
      </Button>
    </div>
  );
}

function NotebookGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-44 rounded-xl" />
      ))}
    </div>
  );
}
