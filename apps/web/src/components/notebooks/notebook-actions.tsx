'use client';

import type { NotebookSummary } from '@notebook-lite/shared';
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DeleteNotebookDialog } from './delete-notebook-dialog';
import { NotebookFormDialog } from './notebook-form-dialog';

/** "…" menu with Edit and Delete for one notebook (overview cards and notebook header). */
export function NotebookActions({
  notebook,
  onDeleted,
}: {
  notebook: NotebookSummary;
  onDeleted?: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${notebook.name}`} />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <PencilIcon />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NotebookFormDialog open={editOpen} onOpenChange={setEditOpen} notebook={notebook} />
      <DeleteNotebookDialog
        notebook={notebook}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={onDeleted}
      />
    </>
  );
}
