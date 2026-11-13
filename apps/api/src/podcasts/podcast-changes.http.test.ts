import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { JWKS } from '../auth/jwks.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { fakeDb } from '../testing/fake-db.js';
import { createTestKeys, testEnv } from '../testing/fixtures.js';
import type { PodcastChangeFeed, PodcastFeedEvent } from '../trpc/context.js';
import { PodcastChangeListener } from './podcast-change-listener.js';

const notebookId = '7f4c1a52-2b8e-4a83-9d4e-0d6e5c3b2a10';
const podcastId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

/** Reads an SSE response until `done(received)` holds. */
async function readUntil(res: Response, done: (received: string) => boolean): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let received = '';
  while (!done(received)) {
    // oxlint-disable-next-line no-await-in-loop
    const { value, done: ended } = await reader.read();
    if (ended) break;
    received += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return received;
}

describe('podcasts.onChange over HTTP (SSE)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let token: string;
  const listeners = new Map<string, (event: PodcastFeedEvent) => void>();
  const feed = {
    subscribe: vi.fn<PodcastChangeFeed['subscribe']>((userId, listener) => {
      listeners.set(userId, listener);
      return () => void listeners.delete(userId);
    }),
  };

  beforeAll(async () => {
    const keys = await createTestKeys();
    token = await keys.sign({ sub: 'user-1' });
    const env = { ...testEnv, LOG_LEVEL: 'error' as const };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
      .overrideProvider(JWKS)
      .useValue(keys.jwks)
      .overrideProvider(SupabaseService)
      .useValue({ forUser: () => fakeDb().db })
      .overrideProvider(PodcastChangeListener)
      .useValue(feed)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, env);
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  const url = () =>
    `${baseUrl}/trpc/podcasts.onChange?input=${encodeURIComponent(JSON.stringify({ notebookId }))}`;

  it('streams the caller’s podcast changes as SSE events', async () => {
    const res = await fetch(url(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const received = await readUntil(res, (text) => {
      const emit = listeners.get('user-1');
      if (text.includes('event: connected') && emit && !text.includes(podcastId)) {
        emit({
          type: 'changed',
          change: { userId: 'user-1', notebookId, podcastId, status: 'synthesizing' },
        });
      }
      return text.includes(podcastId);
    });
    expect(feed.subscribe).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(received).toContain(
      JSON.stringify({ type: 'changed', podcastId, status: 'synthesizing' }),
    );
    // The stream closed: the subscription is gone.
    await vi.waitFor(() => expect(listeners.has('user-1')).toBe(false));
  });

  it('rejects anonymous subscriptions', async () => {
    feed.subscribe.mockClear();
    const res = await fetch(url(), { headers: { Accept: 'text/event-stream' } });
    const received = await readUntil(res, (text) => text.includes('UNAUTHORIZED'));
    expect(received).toContain('UNAUTHORIZED');
    expect(feed.subscribe).not.toHaveBeenCalled();
  });
});
