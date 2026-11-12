import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/server';

async function CurrentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims.email === 'string' ? data.claims.email : 'unknown user';
  return <p className="text-sm text-muted-foreground">Signed in as {email}</p>;
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-start justify-center gap-6 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Notebook Lite</h1>
      <p className="text-muted-foreground">
        Collect sources in notebooks, chat with them, and turn them into podcasts.
      </p>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <CurrentUser />
      </Suspense>
      <form action="/auth/sign-out" method="post">
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
