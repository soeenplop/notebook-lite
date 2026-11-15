import {
  type FileSourceKind,
  isTerminalSourceStatus,
  SOURCE_MAX_BYTES,
  type Source,
  type SourceStatus,
  sourceKindFromFileName,
  titleFromFileName,
  toStorageFileName,
} from '@notebook-lite/shared';

export type UploadPlan =
  | { ok: true; kind: FileSourceKind; fileName: string; title: string }
  | { ok: false; error: string };

/** Checks a picked file and derives what the upload needs (kind, Storage-safe name, title). */
export function planUpload(file: { name: string; size: number }): UploadPlan {
  const kind = sourceKindFromFileName(file.name);
  if (!kind) return { ok: false, error: `${file.name}: only PDF, DOCX and Markdown are supported` };
  if (file.size === 0) return { ok: false, error: `${file.name} is empty` };
  if (file.size > SOURCE_MAX_BYTES)
    return { ok: false, error: `${file.name} is larger than 25 MB` };
  return {
    ok: true,
    kind,
    fileName: toStorageFileName(file.name),
    title: titleFromFileName(file.name),
  };
}

export const STATUS_LABELS: Record<SourceStatus, string> = {
  pending: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

/** Poll the list while any source is still being processed. */
export function sourcesRefetchInterval(
  sources: readonly Pick<Source, 'status'>[] | undefined,
  intervalMs = 3000,
): number | false {
  return sources?.some((source) => !isTerminalSourceStatus(source.status)) ? intervalMs : false;
}

/** "PDF · 12 pages · 1.2 MB", "Web page · example.com". */
export function describeSource(
  source: Pick<Source, 'kind' | 'originalUrl' | 'pageCount' | 'sizeBytes'>,
): string {
  if (source.kind === 'url') {
    const host = source.originalUrl ? URL.parse(source.originalUrl)?.hostname : undefined;
    return host ? `Web page · ${host}` : 'Web page';
  }
  const parts: string[] = [source.kind === 'md' ? 'Markdown' : source.kind.toUpperCase()];
  if (source.pageCount)
    parts.push(`${source.pageCount} ${source.pageCount === 1 ? 'page' : 'pages'}`);
  if (source.sizeBytes) parts.push(formatBytes(source.sizeBytes));
  return parts.join(' · ');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
