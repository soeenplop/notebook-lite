import { z } from 'zod';
import { languageCodeSchema } from './languages.js';

/** Limits mirror the check constraints on public.notebooks. */
export const NOTEBOOK_NAME_MAX_LENGTH = 120;
export const NOTEBOOK_DESCRIPTION_MAX_LENGTH = 2000;

export const notebookIdSchema = z.uuid();

export const notebookNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(NOTEBOOK_NAME_MAX_LENGTH, `Name must be at most ${NOTEBOOK_NAME_MAX_LENGTH} characters`);

/** Optional description: blank input is stored as null. */
export const notebookDescriptionSchema = z
  .string()
  .trim()
  .max(
    NOTEBOOK_DESCRIPTION_MAX_LENGTH,
    `Description must be at most ${NOTEBOOK_DESCRIPTION_MAX_LENGTH} characters`,
  )
  .nullable()
  .transform((value) => (value ? value : null));

export const createNotebookInputSchema = z.object({
  name: notebookNameSchema,
  description: notebookDescriptionSchema.optional().transform((value) => value ?? null),
  language: languageCodeSchema,
});
export type CreateNotebookInput = z.input<typeof createNotebookInputSchema>;

export const updateNotebookInputSchema = z
  .object({
    id: notebookIdSchema,
    name: notebookNameSchema.optional(),
    description: notebookDescriptionSchema.optional(),
    language: languageCodeSchema.optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined || input.description !== undefined || input.language !== undefined,
    { message: 'Nothing to update' },
  );
export type UpdateNotebookInput = z.input<typeof updateNotebookInputSchema>;

export const notebookByIdInputSchema = z.object({ id: notebookIdSchema });

export const notebookSchema = z.object({
  id: notebookIdSchema,
  name: z.string(),
  description: z.string().nullable(),
  language: languageCodeSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Notebook = z.infer<typeof notebookSchema>;

export const notebookCountsSchema = z.object({
  sources: z.number().int().nonnegative(),
  chats: z.number().int().nonnegative(),
  podcasts: z.number().int().nonnegative(),
});
export type NotebookCounts = z.infer<typeof notebookCountsSchema>;

/** A notebook with the number of items it contains (overview cards, delete confirmation). */
export const notebookSummarySchema = notebookSchema.extend({ counts: notebookCountsSchema });
export type NotebookSummary = z.infer<typeof notebookSummarySchema>;
