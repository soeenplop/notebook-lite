'use client';

import {
  CHAT_TITLE_MAX_LENGTH,
  type ChatSummary,
  renameChatInputSchema,
} from '@notebook-lite/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { chatTitle } from '@/lib/chat';
import { useTRPC } from '@/lib/trpc/react';

/** "…" menu with Rename and Delete for one chat (chat list and chat header). */
export function ChatActions({ chat, onDeleted }: { chat: ChatSummary; onDeleted?: () => void }) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const title = chatTitle(chat.title);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${title}`} />}
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          {renameOpen && <RenameForm chat={chat} onDone={() => setRenameOpen(false)} />}
        </DialogContent>
      </Dialog>
      <DeleteChatDialog
        chat={chat}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={onDeleted}
      />
    </>
  );
}

function useInvalidateChat(chat: ChatSummary) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.chats.list.queryFilter({ notebookId: chat.notebookId })),
      queryClient.invalidateQueries(trpc.chats.get.queryFilter({ id: chat.id })),
    ]);
}

function RenameForm({ chat, onDone }: { chat: ChatSummary; onDone: () => void }) {
  const trpc = useTRPC();
  const invalidate = useInvalidateChat(chat);
  const inputId = useId();
  const [title, setTitle] = useState(chat.title ?? '');
  const [error, setError] = useState<string | null>(null);
  const rename = useMutation(
    trpc.chats.rename.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        onDone();
      },
      onError: (mutationError) => toast.error(mutationError.message),
    }),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = renameChatInputSchema.safeParse({ id: chat.id, title });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid title');
      return;
    }
    rename.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Rename chat</DialogTitle>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor={inputId}>Title</Label>
        <Input
          id={inputId}
          value={title}
          maxLength={CHAT_TITLE_MAX_LENGTH}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={rename.isPending}>
          {rename.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeleteChatDialog({
  chat,
  open,
  onOpenChange,
  onDeleted,
}: {
  chat: ChatSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const remove = useMutation(
    trpc.chats.delete.mutationOptions({
      onSuccess: async () => {
        onOpenChange(false);
        queryClient.removeQueries(trpc.chats.get.queryFilter({ id: chat.id }));
        await Promise.all([
          queryClient.invalidateQueries(
            trpc.chats.list.queryFilter({ notebookId: chat.notebookId }),
          ),
          queryClient.invalidateQueries(trpc.notebooks.get.queryFilter({ id: chat.notebookId })),
        ]);
        toast.success(`Deleted “${chatTitle(chat.title)}”`);
        onDeleted?.();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{chatTitle(chat.title)}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the chat and its messages. Your sources stay in the notebook.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: chat.id })}
          >
            {remove.isPending ? 'Deleting…' : 'Delete chat'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
