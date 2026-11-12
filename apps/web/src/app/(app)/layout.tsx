import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/server';

async function CurrentUserEmail() {
  // Request-time only: getClaims() reads the clock (token expiry), which must not happen while
  // prerendering.
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims.email === 'string' ? data.claims.email : null;
  return email ? <span className="hidden text-muted-foreground sm:inline">{email}</span> : null;
}

/** Shell for all signed-in pages (the proxy redirects signed-out users to /login). */
export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" className="font-semibold tracking-tight">
            Notebook Lite
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Suspense>
              <CurrentUserEmail />
            </Suspense>
            <form action="/auth/sign-out" method="post">
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
