'use client';

import {
  createNotebookInputSchema,
  LANGUAGE_CODES,
  type LanguageCode,
  NOTEBOOK_DESCRIPTION_MAX_LENGTH,
  NOTEBOOK_NAME_MAX_LENGTH,
  type NotebookSummary,
  pickSupportedLanguage,
} from '@notebook-lite/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { languageName } from '@/lib/format';
import { useTRPC } from '@/lib/trpc/react';

const LANGUAGE_ITEMS = LANGUAGE_CODES.map((code) => ({ value: code, label: languageName(code) }));

interface NotebookFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this notebook; create a new one when omitted. */
  notebook?: NotebookSummary;
  onSaved?: (notebook: NotebookSummary) => void;
}

export function NotebookFormDialog({
  open,
  onOpenChange,
  notebook,
  onSaved,
}: NotebookFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted only while open, so every opening starts from fresh form state. */}
        {open && (
          <NotebookForm
            notebook={notebook}
            onDone={(saved) => {
              onOpenChange(false);
              onSaved?.(saved);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type FieldErrors = Partial<Record<'name' | 'description' | 'language', string>>;

function onError(error: { message: string }) {
  toast.error(error.message);
}

function NotebookForm({
  notebook,
  onDone,
  onCancel,
}: {
  notebook?: NotebookSummary;
  onDone: (notebook: NotebookSummary) => void;
  onCancel: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const ids = { name: useId(), description: useId(), language: useId() };
  const isEdit = notebook !== undefined;

  const [name, setName] = useState(notebook?.name ?? '');
  const [description, setDescription] = useState(notebook?.description ?? '');
  const [language, setLanguage] = useState<LanguageCode>(
    () => notebook?.language ?? pickSupportedLanguage(navigator.languages),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const clearError = (field: keyof FieldErrors) =>
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));

  const onSuccess = async (saved: NotebookSummary) => {
    await queryClient.invalidateQueries(trpc.notebooks.pathFilter());
    toast.success(isEdit ? 'Notebook updated' : 'Notebook created');
    onDone(saved);
  };
  const create = useMutation(trpc.notebooks.create.mutationOptions({ onSuccess, onError }));
  const update = useMutation(trpc.notebooks.update.mutationOptions({ onSuccess, onError }));
  const pending = create.isPending || update.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = createNotebookInputSchema.safeParse({ name, description, language });
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors;
      setErrors({
        name: fieldErrors.name?.[0],
        description: fieldErrors.description?.[0],
        language: fieldErrors.language?.[0],
      });
      return;
    }
    setErrors({});
    if (notebook) update.mutate({ id: notebook.id, ...parsed.data });
    else create.mutate(parsed.data);
  }

  const languageChanged = isEdit && language !== notebook.language;

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit notebook' : 'New notebook'}</DialogTitle>
        <DialogDescription>
          The language is used for everything generated in this notebook: answers, titles and
          podcasts.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor={ids.name}>Name</Label>
        <Input
          id={ids.name}
          value={name}
          maxLength={NOTEBOOK_NAME_MAX_LENGTH}
          onChange={(event) => {
            setName(event.target.value);
            clearError('name');
          }}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? `${ids.name}-error` : undefined}
          disabled={pending}
          required
        />
        {errors.name && (
          <p id={`${ids.name}-error`} className="text-sm text-destructive">
            {errors.name}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={ids.description}>
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={ids.description}
          value={description}
          maxLength={NOTEBOOK_DESCRIPTION_MAX_LENGTH}
          onChange={(event) => {
            setDescription(event.target.value);
            clearError('description');
          }}
          aria-invalid={errors.description ? true : undefined}
          disabled={pending}
          rows={3}
        />
        {errors.description && <p className="text-sm text-destructive">{errors.description}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={ids.language}>Language</Label>
        <Select
          items={LANGUAGE_ITEMS}
          value={language}
          onValueChange={(value) => {
            if (value) setLanguage(value);
          }}
          disabled={pending}
        >
          <SelectTrigger id={ids.language} className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {languageChanged && (
          <p className="text-sm text-muted-foreground">
            Applies to new answers and podcasts. Existing ones stay as they are.
          </p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : isEdit ? 'Save' : 'Create notebook'}
        </Button>
      </DialogFooter>
    </form>
  );
}
