import type { Metadata } from 'next';
import './globals.css';
import { Geist } from 'next/font/google';
import { Providers } from '@/components/providers';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Notebook Lite',
  description: 'Chat with your sources and turn them into podcasts.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
