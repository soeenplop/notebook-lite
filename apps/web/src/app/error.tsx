'use client';

import { Button } from '@/components/ui/button';

/**
 * Route-level error boundary: shown when rendering a page fails. The full error is logged on
 * the server; the digest lets users reference it.
 */
export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground">
        The page could not be loaded. Please try again in a moment.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">Error reference: {error.digest}</p>
      )}
      <Button onClick={retry}>Try again</Button>
    </main>
  );
}
