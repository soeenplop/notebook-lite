import {
  PODCAST_CHANGES_CHANNEL,
  type PodcastChangeEvent,
  podcastChangeNotificationSchema,
} from '@notebook-lite/shared';
import type { PodcastChangeFeed, PodcastFeedEvent } from '../trpc/context.js';

/** The part of a `pg.Client` the hub uses (lets tests pass a fake). */
export interface ListenClient {
  on(
    event: 'notification',
    listener: (message: { channel: string; payload?: string }) => void,
  ): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
}

export interface PodcastChangeHubOptions {
  /** Opens a dedicated session-mode connection (LISTEN does not work through a pooler in transaction mode). */
  connect: () => Promise<ListenClient>;
  logger: { warn(message: string): void; error(message: string, stack?: string): void };
  /** Reconnect delays, doubled per failure up to `maxRetryMs`. */
  minRetryMs?: number;
  maxRetryMs?: number;
}

type Listener = (event: PodcastFeedEvent) => void;

/**
 * Fans out `PODCAST_CHANGES_CHANNEL` notifications to subscribers, keyed by user id. One
 * connection per API process, opened on the first subscription and kept afterwards. When the
 * connection drops it reconnects (while anyone listens) and sends `resync` to every subscriber,
 * since notifications in between are lost.
 */
export class PodcastChangeHub implements PodcastChangeFeed {
  readonly #options: PodcastChangeHubOptions;
  readonly #listeners = new Map<string, Set<Listener>>();
  #client: ListenClient | null = null;
  #connecting = false;
  #connectedBefore = false;
  #retryMs: number;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #closed = false;

  constructor(options: PodcastChangeHubOptions) {
    this.#options = options;
    this.#retryMs = options.minRetryMs ?? 1000;
  }

  subscribe(userId: string, listener: Listener): () => void {
    const set = this.#listeners.get(userId) ?? new Set<Listener>();
    set.add(listener);
    this.#listeners.set(userId, set);
    this.#start();
    return () => {
      set.delete(listener);
      if (set.size === 0 && this.#listeners.get(userId) === set) this.#listeners.delete(userId);
    };
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    const client = this.#client;
    this.#client = null;
    await client?.end().catch(() => undefined);
  }

  #start(): void {
    if (this.#closed || this.#client || this.#connecting || this.#retryTimer) return;
    this.#connecting = true;
    void this.#connect().finally(() => {
      this.#connecting = false;
    });
  }

  async #connect(): Promise<void> {
    let client: ListenClient | null = null;
    try {
      client = await this.#options.connect();
      const connected = client;
      connected.on('notification', (message) => this.#dispatch(message));
      connected.on('error', (error) => this.#lost(connected, error));
      connected.on('end', () => this.#lost(connected));
      await connected.query(`LISTEN ${PODCAST_CHANGES_CHANNEL}`);
      if (this.#closed) {
        await connected.end();
        return;
      }
      this.#client = connected;
      this.#retryMs = this.#options.minRetryMs ?? 1000;
      if (this.#connectedBefore) this.#broadcast({ type: 'resync' });
      this.#connectedBefore = true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.#options.logger.error(`Could not listen for podcast changes: ${err.message}`, err.stack);
      await client?.end().catch(() => undefined);
      this.#scheduleRetry();
    }
  }

  #lost(client: ListenClient, error?: Error): void {
    if (this.#client !== client) return;
    this.#client = null;
    this.#options.logger.warn(
      `Podcast change listener disconnected${error ? `: ${error.message}` : ''}`,
    );
    void client.end().catch(() => undefined);
    this.#scheduleRetry();
  }

  #scheduleRetry(): void {
    if (this.#closed || this.#retryTimer) return;
    const delay = this.#retryMs;
    this.#retryMs = Math.min(delay * 2, this.#options.maxRetryMs ?? 30_000);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      // Reconnect lazily: the next subscription starts it if nobody listens now.
      if (this.#listeners.size > 0) this.#start();
    }, delay);
    this.#retryTimer.unref?.();
  }

  #dispatch(message: { channel: string; payload?: string }): void {
    if (message.channel !== PODCAST_CHANGES_CHANNEL || !message.payload) return;
    let payload: unknown;
    try {
      payload = JSON.parse(message.payload);
    } catch {
      payload = undefined;
    }
    const parsed = podcastChangeNotificationSchema.safeParse(payload);
    if (!parsed.success) {
      this.#options.logger.warn('Ignoring malformed podcast change notification');
      return;
    }
    const listeners = this.#listeners.get(parsed.data.userId);
    if (!listeners) return;
    for (const listener of listeners) listener({ type: 'changed', change: parsed.data });
  }

  #broadcast(event: PodcastFeedEvent): void {
    for (const listeners of this.#listeners.values()) {
      for (const listener of listeners) listener(event);
    }
  }
}

/**
 * Subscription events for one notebook of one user, until `signal` aborts (the client went away).
 */
export async function* podcastChangeEvents(
  feed: PodcastChangeFeed,
  userId: string,
  notebookId: string,
  signal?: AbortSignal,
): AsyncGenerator<PodcastChangeEvent, void, undefined> {
  const pending: PodcastChangeEvent[] = [];
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  const unsubscribe = feed.subscribe(userId, (event) => {
    if (event.type === 'resync') {
      pending.push({ type: 'resync' });
    } else if (event.change.notebookId === notebookId) {
      pending.push({
        type: 'changed',
        podcastId: event.change.podcastId,
        status: event.change.status,
      });
    } else {
      return;
    }
    notify();
  });
  signal?.addEventListener('abort', notify);
  try {
    for (;;) {
      if (signal?.aborted) return;
      const next = pending.shift();
      if (next) {
        yield next;
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', notify);
  }
}
