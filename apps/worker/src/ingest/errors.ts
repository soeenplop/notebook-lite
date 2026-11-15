/**
 * A permanent ingestion failure with a message the user can read (shown in the sources list).
 * The job is not retried: the same input would fail again.
 */
export class IngestError extends Error {
  override readonly name = 'IngestError';
}

/** The source or its notebook was deleted while the job ran: stop quietly. */
export class SourceGoneError extends Error {
  override readonly name = 'SourceGoneError';
}
