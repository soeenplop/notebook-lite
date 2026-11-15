'use client';

import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc/react';

/** Shows how the API sees the current user (end-to-end check of auth + tRPC). */
export function ApiStatus() {
  const trpc = useTRPC();
  const me = useQuery(trpc.auth.me.queryOptions());

  if (me.isPending) return <p className="text-sm text-muted-foreground">Contacting API…</p>;
  if (me.isError) {
    return <p className="text-sm text-destructive">API error: {me.error.message}</p>;
  }
  return (
    <p className="text-sm text-muted-foreground">
      API authenticated you as <span className="font-mono">{me.data.id}</span>
    </p>
  );
}
