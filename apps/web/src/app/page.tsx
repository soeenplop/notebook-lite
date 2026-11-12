import { Button } from '@/components/ui/button';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-start justify-center gap-6 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Notebook Lite</h1>
      <p className="text-muted-foreground">
        Collect sources in notebooks, chat with them, and turn them into podcasts.
      </p>
      <Button disabled>Sign in (coming soon)</Button>
    </main>
  );
}
