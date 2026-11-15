import { EventEmitter } from 'node:events';
import { PODCAST_CHANGES_CHANNEL, type PodcastChangeEvent } from '@notebook-lite/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PodcastChangeFeed, PodcastFeedEvent } from '../trpc/context.js';
import { type ListenClient, PodcastChangeHub, podcastChangeEvents } from './podcast-changes.js';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const NOTEBOOK = '33333333-3333-4333-8333-333333333333';
const OTHER_NOTEBOOK = '44444444-4444-4444-8444-444444444444';
const PODCAST = '55555555-5555-4555-8555-555555555555';

class FakeClient extends EventEmitter implements ListenClient {
  queries: string[] = [];
  ended = false;
  async query(sql: string) {
    this.queries.push(sql);
    return {};
  }
  async end() {
    this.ended = true;
  }
  notify(payload: object | string) {
    this.emit('notification', {
      channel: PODCAST_CHANGES_CHANNEL,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
  }
}

const logger = {
  warn: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string, stack?: string) => void>(),
};

function hubWith(...clients: FakeClient[]) {
  const connect = vi.fn<() => Promise<ListenClient>>(async () => {
    const client = clients.shift();
    if (!client) throw new Error('no connection');
    return client;
  });
  return { hub: new PodcastChangeHub({ connect, logger, minRetryMs: 10 }), connect };
}

const change = (overrides: object = {}) => ({
  userId: USER,
  notebookId: NOTEBOOK,
  podcastId: PODCAST,
  status: 'synthesizing',
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('PodcastChangeHub', () => {
  it('connects lazily, LISTENs once and delivers only the subscriber’s own changes', async () => {
    const client = new FakeClient();
    const { hub, connect } = hubWith(client);
    expect(connect).not.toHaveBeenCalled();

    const mine: PodcastFeedEvent[] = [];
    const theirs: PodcastFeedEvent[] = [];
    hub.subscribe(USER, (event) => mine.push(event));
    hub.subscribe(OTHER_USER, (event) => theirs.push(event));
    await vi.waitFor(() => expect(client.queries).toEqual([`LISTEN ${PODCAST_CHANGES_CHANNEL}`]));
    expect(connect).toHaveBeenCalledTimes(1);

    client.notify(change());
    expect(mine).toEqual([{ type: 'changed', change: change() }]);
    expect(theirs).toEqual([]);
    await hub.close();
    expect(client.ended).toBe(true);
  });

  it('ignores malformed payloads and other channels', async () => {
    const client = new FakeClient();
    const { hub } = hubWith(client);
    const events: PodcastFeedEvent[] = [];
    hub.subscribe(USER, (event) => events.push(event));
    await vi.waitFor(() => expect(client.queries).toHaveLength(1));

    client.notify('not json');
    client.notify(change({ status: 'bogus' }));
    client.emit('notification', { channel: 'other', payload: JSON.stringify(change()) });
    expect(events).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    await hub.close();
  });

  it('stops delivering after unsubscribe', async () => {
    const client = new FakeClient();
    const { hub } = hubWith(client);
    const events: PodcastFeedEvent[] = [];
    const unsubscribe = hub.subscribe(USER, (event) => events.push(event));
    await vi.waitFor(() => expect(client.queries).toHaveLength(1));
    unsubscribe();
    client.notify(change());
    expect(events).toEqual([]);
    await hub.close();
  });

  it('reconnects after the connection drops and tells subscribers to resync', async () => {
    const first = new FakeClient();
    const second = new FakeClient();
    const { hub, connect } = hubWith(first, second);
    const events: PodcastFeedEvent[] = [];
    hub.subscribe(USER, (event) => events.push(event));
    await vi.waitFor(() => expect(first.queries).toHaveLength(1));

    first.emit('error', new Error('connection reset'));
    expect(first.ended).toBe(true);
    await vi.waitFor(() => expect(second.queries).toHaveLength(1));
    expect(connect).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ type: 'resync' }]);

    second.notify(change());
    expect(events).toHaveLength(2);
    await hub.close();
  });

  it('retries a failed first connection without sending resync', async () => {
    const client = new FakeClient();
    const connect = vi
      .fn<() => Promise<ListenClient>>()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(client);
    const hub = new PodcastChangeHub({ connect, logger, minRetryMs: 10 });
    const events: PodcastFeedEvent[] = [];
    hub.subscribe(USER, (event) => events.push(event));
    await vi.waitFor(() => expect(client.queries).toHaveLength(1));
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
    await hub.close();
  });
});

function fakeFeed() {
  const listeners = new Set<(event: PodcastFeedEvent) => void>();
  const feed: PodcastChangeFeed = {
    subscribe: (_userId, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const emit = (event: PodcastFeedEvent) => {
    for (const listener of listeners) listener(event);
  };
  return { feed, emit, listeners };
}

describe('podcastChangeEvents', () => {
  it('yields changes of the notebook and resyncs, then unsubscribes on abort', async () => {
    const { feed, emit, listeners } = fakeFeed();
    const controller = new AbortController();
    const events = podcastChangeEvents(feed, USER, NOTEBOOK, controller.signal);
    const first = events.next();
    await vi.waitFor(() => expect(listeners.size).toBe(1));

    emit({ type: 'changed', change: change({ notebookId: OTHER_NOTEBOOK }) as never });
    emit({ type: 'changed', change: change() as never });
    emit({ type: 'resync' });

    const expected: PodcastChangeEvent[] = [
      { type: 'changed', podcastId: PODCAST, status: 'synthesizing' },
      { type: 'resync' },
    ];
    expect((await first).value).toEqual(expected[0]);
    expect((await events.next()).value).toEqual(expected[1]);

    const pending = events.next();
    controller.abort();
    expect((await pending).done).toBe(true);
    expect(listeners.size).toBe(0);
  });
});
