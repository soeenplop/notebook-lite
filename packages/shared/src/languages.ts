import { z } from 'zod';

/**
 * Languages a notebook can use. The notebook language drives every AI operation inside the
 * notebook (answers, titles, query rewriting, topic suggestions, podcast scripts, TTS) and the
 * Postgres full-text search configuration.
 *
 * Adding a language: add an entry here AND extend the `notebooks.language` check constraint and
 * `public.language_regconfig()` in a new migration.
 */
export const SUPPORTED_LANGUAGES = {
  de: {
    code: 'de',
    name: 'Deutsch',
    englishName: 'German',
    ftsConfig: 'german',
    elevenLabsCode: 'de',
    /** ElevenLabs voice IDs: A hosts (and speaks monologues), B joins dialogues. */
    podcastVoices: { A: 'gSZiss4v1BGsE1cTgoWF', B: 'cwXXmRbp4lGQdqLfbcKH' },
    wordsPerMinute: 130,
  },
  en: {
    code: 'en',
    name: 'English',
    englishName: 'English',
    ftsConfig: 'english',
    elevenLabsCode: 'en',
    podcastVoices: { A: 'T2sZgOl8ol4kf4u6yM2z', B: 'BAdH0bMfq6VleQGLXj38' },
    wordsPerMinute: 150,
  },
} as const;

export const LANGUAGE_CODES = [
  'de',
  'en',
] as const satisfies readonly (keyof typeof SUPPORTED_LANGUAGES)[];
export const languageCodeSchema = z.enum(LANGUAGE_CODES);
export type LanguageCode = z.infer<typeof languageCodeSchema>;
export type LanguageInfo = (typeof SUPPORTED_LANGUAGES)[LanguageCode];

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export function getLanguage(code: LanguageCode): LanguageInfo {
  return SUPPORTED_LANGUAGES[code];
}

/**
 * Picks the first supported language from a list of preferred language tags
 * (e.g. `navigator.languages` or a parsed `Accept-Language` header), falling back to
 * {@link DEFAULT_LANGUAGE}.
 */
export function pickSupportedLanguage(preferred: readonly string[]): LanguageCode {
  for (const tag of preferred) {
    const base = tag.trim().toLowerCase().split(/[-_]/)[0];
    const parsed = languageCodeSchema.safeParse(base);
    if (parsed.success) return parsed.data;
  }
  return DEFAULT_LANGUAGE;
}
