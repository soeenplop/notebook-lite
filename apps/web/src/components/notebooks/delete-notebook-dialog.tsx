'use client';

import type { NotebookSummary } from '@notebook-lite/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { joinWithAnd, pluralize } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/react';

interface DeleteNotebookDialogProps {
  notebook: NotebookSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

/** Describes what deleting a notebook removes, e.g. "3 sources and 1 chat". */
export function describeContents(counts: NotebookSummary['counts']): string | null {
  const parts = [
    counts.sources > 0 ? pluralize(counts.sources, 'source') : null,
    counts.chats > 0 ? pluralize(counts.chats, 'chat') : null,
    counts.podcasts > 0 ? pluralize(counts.podcasts, 'podcast') : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? joinWithAnd(parts) : null;
}

export function DeleteNotebookDialog({
  notebook,
  open,
  onOpenChange,
  onDeleted,
}: DeleteNotebookDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const remove = useMutation(
    trpc.notebooks.delete.mutationOptions({
      onSuccess: async () => {
        onOpenChange(false);
        // Drop the deleted notebook's own query instead of refetching it (it would 404).
        queryClient.removeQueries(trpc.notebooks.get.queryFilter({ id: notebook.id }));
        await queryClient.invalidateQueries(trpc.notebooks.list.queryFilter());
        toast.success(`Deleted “${notebook.name}”`);
        onDeleted?.();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const contents = describeContents(notebook.counts);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{notebook.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {contents
              ? `This permanently deletes the notebook with its ${contents}.`
              : 'This permanently deletes the notebook.'}{' '}
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: notebook.id })}
          >
            {remove.isPending ? 'Deleting…' : 'Delete notebook'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
