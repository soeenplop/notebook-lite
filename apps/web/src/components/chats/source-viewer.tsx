'use client';

import type { Citation } from '@notebook-lite/shared';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useTRPC } from '@/lib/trpc/react';
import { Markdown } from './markdown';

function pageLabel(start: number | null, end: number | null): string | null {
  if (start === null) return null;
  return end !== null && end !== start ? `Pages ${start}–${end}` : `Page ${start}`;
}

/**
 * Side panel with the cited passage. Loads the full chunk; once the source was deleted it falls
 * back to the quote stored with the answer.
 */
export function SourceViewer({
  citation,
  onClose,
}: {
  citation: Citation | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={citation !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        {citation && <Passage citation={citation} />}
      </SheetContent>
    </Sheet>
  );
}

function Passage({ citation }: { citation: Citation }) {
  const trpc = useTRPC();
  const chunk = useQuery({
    ...trpc.chats.chunk.queryOptions({ chunkId: citation.chunkId }),
    staleTime: Infinity,
    retry: (failureCount, error) => error.data?.code !== 'NOT_FOUND' && failureCount < 1,
  });
  const deleted = chunk.error?.data?.code === 'NOT_FOUND';
  const title = chunk.data?.sourceTitle || citation.sourceTitle || 'Untitled source';
  const page = chunk.data
    ? pageLabel(chunk.data.pageStart, chunk.data.pageEnd)
    : pageLabel(citation.page, citation.page);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2 pr-8">
          <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary tabular-nums">
            {citation.marker}
          </span>
          <span className="min-w-0 break-words">{title}</span>
          {deleted && <Badge variant="destructive">Source deleted</Badge>}
        </SheetTitle>
        <SheetDescription>
          {[page, chunk.data?.headingPath.join(' › ')].filter(Boolean).join(' · ') ||
            'Cited passage'}
        </SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {chunk.isPending ? (
          <div className="grid gap-2" aria-busy="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : chunk.data ? (
          <blockquote className="rounded-lg border-l-4 border-primary bg-primary/5 p-3">
            <Markdown text={chunk.data.content} className="text-sm leading-relaxed break-words" />
          </blockquote>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              {deleted
                ? 'The source was deleted. This is the excerpt saved with the answer.'
                : `Could not load the passage: ${chunk.error?.message ?? 'unknown error'}`}
            </p>
            <blockquote className="rounded-lg border-l-4 bg-muted p-3">
              <Markdown text={citation.quote} className="text-sm leading-relaxed break-words" />
            </blockquote>
          </div>
        )}
      </div>
    </>
  );
}
