import { ArrowLeftIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/** Page frame of the podcast pages: a back link and the content column. */
export function PodcastFrame({
  backHref,
  backLabel,
  children,
}: {
  backHref: string;
  backLabel: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-8">
      <Link
        href={backHref}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        <span className="max-w-64 truncate">{backLabel}</span>
      </Link>
      {children}
    </main>
  );
}

export function PodcastNotFound({
  what,
  backHref,
  backLabel,
}: {
  what: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <PodcastFrame backHref={backHref} backLabel={backLabel}>
      <div className="grid gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
        <h1 className="text-lg font-medium">{what} not found</h1>
        <p className="text-sm text-muted-foreground">
          It may have been deleted, or the link is wrong.
        </p>
        <div>
          <Button render={<Link href={backHref} />} variant="outline">
            {backLabel}
          </Button>
        </div>
      </div>
    </PodcastFrame>
  );
}
