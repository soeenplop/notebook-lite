import { describe, expect, it } from 'vitest';
import {
  createNotebookInputSchema,
  NOTEBOOK_DESCRIPTION_MAX_LENGTH,
  NOTEBOOK_NAME_MAX_LENGTH,
  updateNotebookInputSchema,
} from './notebooks.js';

const id = '7f4c1a52-2b8e-4a83-9d4e-0d6e5c3b2a10';

describe('createNotebookInputSchema', () => {
  it('trims fields and stores a blank description as null', () => {
    expect(
      createNotebookInputSchema.parse({ name: '  Research ', description: '   ', language: 'de' }),
    ).toEqual({ name: 'Research', description: null, language: 'de' });
  });

  it('defaults a missing description to null', () => {
    expect(createNotebookInputSchema.parse({ name: 'X', language: 'en' }).description).toBeNull();
  });

  it('rejects blank or too long names, long descriptions and unsupported languages', () => {
    const bad = [
      { name: '   ', language: 'en' },
      { name: 'x'.repeat(NOTEBOOK_NAME_MAX_LENGTH + 1), language: 'en' },
      { name: 'x', description: 'd'.repeat(NOTEBOOK_DESCRIPTION_MAX_LENGTH + 1), language: 'en' },
      { name: 'x', language: 'fr' },
    ];
    for (const input of bad) expect(createNotebookInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('updateNotebookInputSchema', () => {
  it('accepts partial updates and clearing the description', () => {
    expect(updateNotebookInputSchema.parse({ id, description: '' })).toEqual({
      id,
      description: null,
    });
    expect(updateNotebookInputSchema.parse({ id, language: 'en' })).toEqual({ id, language: 'en' });
  });

  it('requires at least one field and a valid id', () => {
    expect(updateNotebookInputSchema.safeParse({ id }).success).toBe(false);
    expect(updateNotebookInputSchema.safeParse({ id: 'nope', name: 'x' }).success).toBe(false);
  });
});
