import { z } from 'zod';

/**
 * Background job contracts (pg-boss). The api enqueues, the worker consumes.
 * Every payload carries `userId`: the worker uses the service role and must scope every
 * query by it explicitly.
 */
export const ingestSourceJobSchema = z.object({
  sourceId: z.uuid(),
  notebookId: z.uuid(),
  userId: z.uuid(),
});

export const generatePodcastJobSchema = z.object({
  podcastId: z.uuid(),
  notebookId: z.uuid(),
  userId: z.uuid(),
});

export const JOB_SCHEMAS = {
  'ingest-source': ingestSourceJobSchema,
  'generate-podcast': generatePodcastJobSchema,
} as const;

export type QueueName = keyof typeof JOB_SCHEMAS;
export type JobData<Q extends QueueName> = z.infer<(typeof JOB_SCHEMAS)[Q]>;
export type IngestSourceJob = JobData<'ingest-source'>;
export type GeneratePodcastJob = JobData<'generate-podcast'>;

export const QUEUE_NAMES = [
  'ingest-source',
  'generate-podcast',
] as const satisfies readonly QueueName[];

/** Validates a payload against the contract of queue `name`. Throws a ZodError if invalid. */
export function parseJobData<Q extends QueueName>(name: Q, data: unknown): JobData<Q> {
  // The schema for `name` produces exactly JobData<Q>; TypeScript cannot narrow the lookup.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return JOB_SCHEMAS[name].parse(data) as JobData<Q>;
}
