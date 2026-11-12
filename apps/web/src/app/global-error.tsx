'use client';

import './globals.css';

/** Last-resort error boundary: replaces the root layout when it fails to render. */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground antialiased">
        <h1 className="text-2xl font-semibold tracking-tight">Notebook Lite is unavailable</h1>
        <p className="text-muted-foreground">An unexpected error occurred. Please reload.</p>
        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground">Error reference: {error.digest}</p>
        )}
        <button
          type="button"
          onClick={retry}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Reload
        </button>
      </body>
    </html>
  );
}
