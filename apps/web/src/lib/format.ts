import { type LanguageCode, SUPPORTED_LANGUAGES } from '@notebook-lite/shared';

/** "1 source", "3 chats", "0 podcasts". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Joins items as "a", "a and b" or "a, b and c". */
export function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

export function languageName(code: LanguageCode): string {
  return SUPPORTED_LANGUAGES[code].name;
}

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}
