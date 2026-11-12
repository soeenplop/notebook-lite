import type { Metadata } from 'next';
import { Suspense } from 'react';
import { safeNextPath } from '@/lib/auth-routes';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in · Notebook Lite' };

async function Login({ searchParams }: Pick<PageProps<'/login'>, 'searchParams'>) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null);
  const failed = params.error === 'link';

  return (
    <>
      {failed && (
        <p role="alert" className="max-w-sm text-center text-sm text-destructive">
          That sign-in link is invalid or has expired, or it was opened in a different browser.
          Please request a new one.
        </p>
      )}
      <LoginForm next={next} />
    </>
  );
}

export default function LoginPage({ searchParams }: PageProps<'/login'>) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4">
      <Suspense>
        <Login searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
