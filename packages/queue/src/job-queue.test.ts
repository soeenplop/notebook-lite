import type { Job } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';
import { JobQueue, QUEUE_SETTINGS, type QueueBackend } from './job-queue.js';

const ids = {
  sourceId: '7f0c3a52-3b7e-4c1e-9d2a-5d2f1c0b9e11',
  notebookId: '0b6f8d4e-2a1c-4e3b-8f7d-6c5b4a392817',
  userId: '5e4d3c2b-1a09-4f8e-9d7c-6b5a49382716',
};

function fakeBackend(existingQueues: string[] = []) {
  const queues = new Set(existingQueues);
  let handler: ((jobs: Job<unknown>[]) => Promise<void>) | undefined;
  const backend = {
    start: vi.fn<QueueBackend['start']>(() => Promise.resolve()),
    stop: vi.fn<QueueBackend['stop']>(() => Promise.resolve()),
    getQueue: vi.fn<QueueBackend['getQueue']>((name) =>
      Promise.resolve(queues.has(name) ? { name } : null),
    ),
    createQueue: vi.fn<QueueBackend['createQueue']>((name) => {
      queues.add(name);
      return Promise.resolve();
    }),
    send: vi.fn<QueueBackend['send']>(() => Promise.resolve('job-1')),
    work: vi.fn<QueueBackend['work']>((_name, _options, h) => {
      handler = h;
      return Promise.resolve('worker-1');
    }),
    cancel: vi.fn<QueueBackend['cancel']>(() => Promise.resolve()),
  } satisfies QueueBackend;
  const deliver = (data: unknown) =>
    handler?.([
      {
        id: 'job-1',
        name: 'ingest-source',
        data,
        retryCount: 0,
        signal: new AbortController().signal,
      } as Job<unknown>,
    ]);
  return { backend, deliver };
}

describe('JobQueue', () => {
  it('creates missing queues once with their settings', async () => {
    const { backend } = fakeBackend(['ingest-source']);
    const queue = new JobQueue(backend);

    await Promise.all([queue.start(), queue.start()]);

    expect(backend.start).toHaveBeenCalledTimes(1);
    expect(backend.createQueue).toHaveBeenCalledExactlyOnceWith(
      'generate-podcast',
      QUEUE_SETTINGS['generate-podcast'],
    );
  });

  it('retries start after a failed connection', async () => {
    const { backend } = fakeBackend();
    backend.start.mockRejectedValueOnce(new Error('connection refused'));
    const queue = new JobQueue(backend);

    await expect(queue.start()).rejects.toThrow('connection refused');
    await expect(queue.start()).resolves.toBeUndefined();
  });

  it('validates payloads before sending, starting lazily', async () => {
    const { backend } = fakeBackend();
    const queue = new JobQueue(backend);

    await expect(queue.send('ingest-source', ids, { singletonKey: ids.sourceId })).resolves.toBe(
      'job-1',
    );
    expect(backend.send).toHaveBeenCalledWith('ingest-source', ids, { singletonKey: ids.sourceId });

    const invalid = { ...ids, userId: 'not-a-uuid' };
    await expect(queue.send('ingest-source', invalid)).rejects.toThrow(/uuid/i);
    expect(backend.send).toHaveBeenCalledTimes(1);
  });

  it('works one job at a time with validated data', async () => {
    const { backend, deliver } = fakeBackend();
    const queue = new JobQueue(backend);
    const handler = vi.fn<(data: unknown) => Promise<void>>(() => Promise.resolve());

    await queue.work('ingest-source', handler);
    expect(backend.work).toHaveBeenCalledWith(
      'ingest-source',
      expect.objectContaining({ batchSize: 1, localConcurrency: 1 }),
      expect.any(Function),
    );

    await deliver(ids);
    expect(handler).toHaveBeenCalledWith(
      ids,
      expect.objectContaining({ id: 'job-1', retryCount: 0 }),
    );
    await expect(deliver({ sourceId: 'x' })).rejects.toThrow(/notebookId/);
  });

  it('stops only when started', async () => {
    const { backend } = fakeBackend();
    const queue = new JobQueue(backend);

    await queue.stop();
    expect(backend.stop).not.toHaveBeenCalled();

    await queue.start();
    await queue.stop(5000);
    expect(backend.stop).toHaveBeenCalledWith({ graceful: true, timeout: 5000 });
  });
});
