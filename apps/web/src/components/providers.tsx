'use client';

import type { AppRouter } from '@notebook-lite/api/trpc';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCClient, httpBatchLink, httpBatchStreamLink, splitLink } from '@trpc/client';
import { type ReactNode, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { publicEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/client';
import { TRPCProvider } from '@/lib/trpc/react';

/** Procedures that stream their result; they go through `httpBatchStreamLink`. */
const STREAMING_PROCEDURES = new Set(['podcasts.suggestTopics']);

function makeTrpcClient() {
  const supabase = createClient();
  const options = {
    url: `${publicEnv().NEXT_PUBLIC_API_URL}/trpc`,
    // The API verifies the Supabase access token and queries Postgres as this user (RLS).
    async headers() {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
  };
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => STREAMING_PROCEDURES.has(op.path),
        true: httpBatchStreamLink(options),
        false: httpBatchLink(options),
      }),
    ],
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  const [trpcClient] = useState(makeTrpcClient);

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
        <Toaster position="bottom-right" />
      </TRPCProvider>
    </QueryClientProvider>
  );
}
