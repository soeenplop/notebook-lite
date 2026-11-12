'use client';

import {
  SOURCE_FILE_EXTENSIONS,
  SOURCE_MIME_TYPES,
  type Source,
  sourceStoragePath,
  sourceUrlSchema,
  STORAGE_BUCKETS,
} from '@notebook-lite/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileTextIcon,
  GlobeIcon,
  Loader2Icon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import { type DragEvent, type FormEvent, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { pluralize } from '@/lib/format';
import { describeSource, planUpload, sourcesRefetchInterval, STATUS_LABELS } from '@/lib/sources';
import { createClient } from '@/lib/supabase/client';
import { useTRPC } from '@/lib/trpc/react';

/**
 * Sources of a notebook: upload (directly to Storage, then registered via tRPC), add web pages
 * by URL, status badges (polled while processing) and delete.
 */
export function SourcesPanel({ notebookId }: { notebookId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const sources = useQuery({
    ...trpc.sources.list.queryOptions({ notebookId }),
    refetchInterval: (query) => sourcesRefetchInterval(query.state.data),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.sources.list.queryFilter({ notebookId })),
      queryClient.invalidateQueries(trpc.notebooks.get.queryFilter({ id: notebookId })),
    ]);
  };

  return (
    <section className="grid content-start gap-4 rounded-xl border p-4" aria-labelledby="sources">
      <div className="flex items-center justify-between gap-2">
        <h2 id="sources" className="flex items-center gap-2 font-medium">
          <FileTextIcon className="size-4 text-muted-foreground" aria-hidden />
          Sources
        </h2>
        {sources.data && (
          <span className="text-xs text-muted-foreground">
            {pluralize(sources.data.length, 'source')}
          </span>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <UploadDropzone notebookId={notebookId} onUploaded={refresh} />
        <AddUrlForm notebookId={notebookId} onAdded={refresh} />
      </div>

      {sources.isPending ? (
        <div className="grid gap-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : sources.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load sources: {sources.error.message}
        </p>
      ) : sources.data.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No sources yet. Upload PDF, DOCX or Markdown files, or add a web page by URL.
        </p>
      ) : (
        <ul className="grid gap-2">
          {sources.data.map((source) => (
            <SourceItem key={source.id} source={source} onDeleted={refresh} />
          ))}
        </ul>
      )}
    </section>
  );
}

function UploadDropzone({
  notebookId,
  onUploaded,
}: {
  notebookId: string;
  onUploaded: () => Promise<void>;
}) {
  const trpc = useTRPC();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const me = useQuery(trpc.auth.me.queryOptions());
  const create = useMutation(trpc.sources.create.mutationOptions());

  async function uploadOne(file: File, userId: string): Promise<void> {
    const plan = planUpload(file);
    if (!plan.ok) {
      toast.error(plan.error);
      return;
    }
    const id = crypto.randomUUID();
    const path = sourceStoragePath(userId, notebookId, id, plan.fileName);
    const storage = createClient().storage.from(STORAGE_BUCKETS.sources);
    const { error } = await storage.upload(path, file, {
      contentType: SOURCE_MIME_TYPES[plan.kind],
      upsert: false,
    });
    if (error) {
      toast.error(`${file.name}: upload failed (${error.message})`);
      return;
    }
    try {
      await create.mutateAsync({
        id,
        notebookId,
        kind: plan.kind,
        title: plan.title,
        fileName: plan.fileName,
        sizeBytes: file.size,
      });
    } catch (createError) {
      // Do not leave an orphaned upload behind.
      await storage.remove([path]);
      toast.error(
        `${file.name}: ${createError instanceof Error ? createError.message : 'could not be added'}`,
      );
    }
  }

  async function upload(files: FileList | null) {
    const userId = me.data?.id;
    if (!files || files.length === 0) return;
    if (!userId) {
      toast.error('Your session is still loading. Please try again.');
      return;
    }
    const list = [...files];
    setUploading((count) => count + list.length);
    try {
      for (const file of list) {
        // One upload at a time keeps progress and errors easy to follow.
        // oxlint-disable-next-line no-await-in-loop
        await uploadOne(file, userId);
        setUploading((count) => count - 1);
      }
    } finally {
      setUploading(0);
      if (inputRef.current) inputRef.current.value = '';
      await onUploaded();
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files);
  }

  return (
    // Drag and drop is an enhancement: the label activates the (keyboard-accessible) file input.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <label
      htmlFor={inputId}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors hover:bg-muted/50 ${
        dragging ? 'border-primary bg-muted/50' : ''
      }`}
    >
      {uploading > 0 ? (
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <UploadIcon className="size-5 text-muted-foreground" aria-hidden />
      )}
      <span className="font-medium">
        {uploading > 0 ? `Uploading ${pluralize(uploading, 'file')}…` : 'Upload files'}
      </span>
      <span className="text-xs text-muted-foreground">
        Drop or choose PDF, DOCX or Markdown, up to 25 MB each
      </span>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={SOURCE_FILE_EXTENSIONS.join(',')}
        className="sr-only"
        disabled={uploading > 0}
        onChange={(event) => void upload(event.target.files)}
      />
    </label>
  );
}

function AddUrlForm({ notebookId, onAdded }: { notebookId: string; onAdded: () => Promise<void> }) {
  const trpc = useTRPC();
  const inputId = useId();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation(
    trpc.sources.createFromUrl.mutationOptions({
      onSuccess: async () => {
        setUrl('');
        await onAdded();
      },
      onError: (mutationError) => setError(mutationError.message),
    }),
  );

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = sourceUrlSchema.safeParse(url);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid URL');
      return;
    }
    setError(null);
    add.mutate({ notebookId, url: parsed.data });
  }

  return (
    <form onSubmit={onSubmit} className="grid content-center gap-2 rounded-lg border px-4 py-4">
      <label htmlFor={inputId} className="flex items-center gap-2 text-sm font-medium">
        <GlobeIcon className="size-4 text-muted-foreground" aria-hidden />
        Add a web page
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          type="url"
          inputMode="url"
          placeholder="https://example.com/article"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
        />
        <Button type="submit" disabled={add.isPending || url.trim() === ''}>
          {add.isPending ? (
            <Loader2Icon className="animate-spin" aria-hidden />
          ) : (
            <PlusIcon aria-hidden />
          )}
          Add
        </Button>
      </div>
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function SourceItem({ source, onDeleted }: { source: Source; onDeleted: () => Promise<void> }) {
  const trpc = useTRPC();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation(
    trpc.sources.delete.mutationOptions({
      onSuccess: async () => {
        setConfirming(false);
        toast.success(`Deleted “${source.title}”`);
        await onDeleted();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const Icon = source.kind === 'url' ? GlobeIcon : FileTextIcon;

  return (
    <li className="flex items-start gap-3 rounded-lg border px-3 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium" title={source.title}>
            {source.title}
          </span>
          <StatusBadge status={source.status} />
        </div>
        <span className="truncate text-xs text-muted-foreground">{describeSource(source)}</span>
        {source.status === 'failed' && source.error && (
          <span className="text-xs text-destructive">{source.error}</span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${source.title}`}
        onClick={() => setConfirming(true)}
      >
        <Trash2Icon />
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{source.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The source and its file are deleted. Existing chat answers keep their citations, shown
              as from a deleted source. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ notebookId: source.notebookId, id: source.id })}
            >
              {remove.isPending ? 'Deleting…' : 'Delete source'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function StatusBadge({ status }: { status: Source['status'] }) {
  const label = STATUS_LABELS[status];
  switch (status) {
    case 'ready':
      return <Badge variant="secondary">{label}</Badge>;
    case 'failed':
      return <Badge variant="destructive">{label}</Badge>;
    default:
      return (
        <Badge variant="outline">
          <Loader2Icon className="animate-spin" aria-hidden />
          {label}
        </Badge>
      );
  }
}
