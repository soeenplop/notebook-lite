import { describe, expect, it } from 'vitest';
import { JOB_SCHEMAS, QUEUE_NAMES } from './jobs.js';

const id = '7f0c3a52-3b7e-4c1e-9d2a-5d2f1c0b9e11';

describe('job contracts', () => {
  it('lists every queue', () => {
    expect(QUEUE_NAMES).toEqual(['ingest-source', 'generate-podcast']);
  });

  it('requires the owning user on every payload', () => {
    expect(JOB_SCHEMAS['ingest-source'].safeParse({ sourceId: id, notebookId: id }).success).toBe(
      false,
    );
    expect(
      JOB_SCHEMAS['generate-podcast'].parse({ podcastId: id, notebookId: id, userId: id }),
    ).toEqual({ podcastId: id, notebookId: id, userId: id });
  });
});
