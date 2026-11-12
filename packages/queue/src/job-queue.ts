import { type JobData, parseJobData, QUEUE_NAMES, type QueueName } from '@notebook-lite/shared';
import { type Job, PgBoss, type QueueOptions, type SendOptions } from 'pg-boss';

/** Retry and expiry policy per queue. Applied when a queue is created. */
export const QUEUE_SETTINGS: Record<QueueName, QueueOptions> = {
  'ingest-source': {
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 15 * 60,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
  },
  'generate-podcast': {
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 60 * 60,
    deleteAfterSeconds: 7 * 24 * 60 * 60,
  },
};

export interface JobContext {
  id: string;
  /** 0 on the first attempt. */
  retryCount: number;
  /** Aborted when the job expires or the worker shuts down. */
  signal: AbortSignal;
}

export type JobHandler<Q extends QueueName> = (data: JobData<Q>, job: JobContext) => Promise<void>;

export interface EnqueueOptions {
  /** Drops the job if one with the same key is already queued or active. */
  singletonKey?: string;
  startAfter?: Date | number;
}

/** The part of pg-boss that JobQueue uses (lets tests pass a fake). */
export interface QueueBackend {
  start(): Promise<unknown>;
  stop(options: { graceful: boolean; timeout: number }): Promise<void>;
  getQueue(name: string): Promise<unknown>;
  createQueue(name: string, options: QueueOptions): Promise<void>;
  send(name: string, data: object, options: SendOptions): Promise<string | null>;
  work(
    name: string,
    options: { batchSize: number; localConcurrency: number; pollingIntervalSeconds: number },
    handler: (jobs: Job<unknown>[]) => Promise<void>,
  ): Promise<string>;
  cancel(name: string, id: string): Promise<unknown>;
}

export interface JobQueueConfig {
  /** Postgres connection (session mode, not the transaction pooler). */
  connectionString: string;
  /** Shows up in pg_stat_activity, e.g. `notebook-lite-worker`. */
  applicationName: string;
  /** Max connections of this process (Supabase pooler limits are small). */
  poolSize: number;
  /** Run pg-boss maintenance (expiry, retention) in this process. The worker does it. */
  supervise: boolean;
  onError: (error: Error) => void;
}

/**
 * Typed pg-boss wrapper. Payloads are validated against the contracts in
 * `@notebook-lite/shared` on send and on receive. Workers process at most one job at a time
 * per queue.
 */
export class JobQueue {
  readonly #backend: QueueBackend;
  #started: Promise<void> | undefined;

  constructor(backend: QueueBackend) {
    this.#backend = backend;
  }

  static connect(config: JobQueueConfig): JobQueue {
    const boss = new PgBoss({
      connectionString: config.connectionString,
      application_name: config.applicationName,
      max: config.poolSize,
      supervise: config.supervise,
      schedule: false,
    });
    boss.on('error', config.onError);
    return new JobQueue({
      start: () => boss.start(),
      stop: (options) => boss.stop(options),
      getQueue: (name) => boss.getQueue(name),
      createQueue: (name, options) => boss.createQueue(name, options),
      send: (name, data, options) => boss.send(name, data, options),
      work: (name, options, handler) => boss.work(name, options, handler),
      cancel: (name, id) => boss.cancel(name, id),
    });
  }

  /** Connects, installs/migrates the pg-boss schema and creates missing queues. Idempotent. */
  start(): Promise<void> {
    this.#started ??= this.#startOnce().catch((error: unknown) => {
      this.#started = undefined;
      throw error;
    });
    return this.#started;
  }

  async #startOnce(): Promise<void> {
    await this.#backend.start();
    for (const name of QUEUE_NAMES) {
      // Sequential: a handful of queues, once at startup.
      // oxlint-disable-next-line no-await-in-loop
      if (!(await this.#backend.getQueue(name))) {
        try {
          // oxlint-disable-next-line no-await-in-loop
          await this.#backend.createQueue(name, QUEUE_SETTINGS[name]);
        } catch (error) {
          // Another process (api or worker) may have created it in the meantime.
          // oxlint-disable-next-line no-await-in-loop
          if (!(await this.#backend.getQueue(name))) throw error;
        }
      }
    }
  }

  /** Validates and enqueues a job. Returns its id, or null if a singleton duplicate was dropped. */
  async send<Q extends QueueName>(
    name: Q,
    data: JobData<Q>,
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    const payload = parseJobData(name, data);
    await this.start();
    return this.#backend.send(name, payload, options);
  }

  /** Registers the handler for a queue: one job at a time, retried per QUEUE_SETTINGS. */
  async work<Q extends QueueName>(name: Q, handler: JobHandler<Q>): Promise<string> {
    await this.start();
    return this.#backend.work(
      name,
      { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 },
      async (jobs) => {
        for (const job of jobs) {
          // Throws on a payload that does not match the contract; pg-boss marks the job failed.
          const data = parseJobData(name, job.data);
          // batchSize is 1, so this loop runs once.
          // oxlint-disable-next-line no-await-in-loop
          await handler(data, { id: job.id, retryCount: job.retryCount, signal: job.signal });
        }
      },
    );
  }

  async cancel(name: QueueName, id: string): Promise<void> {
    await this.start();
    await this.#backend.cancel(name, id);
  }

  /** Waits up to `timeoutMs` for active jobs, then disconnects. No-op if never started. */
  async stop(timeoutMs = 30_000): Promise<void> {
    if (!this.#started) return;
    try {
      await this.#started;
    } catch {
      return;
    }
    await this.#backend.stop({ graceful: true, timeout: timeoutMs });
    this.#started = undefined;
  }
}
