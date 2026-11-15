import { describe, expect, it } from 'vitest';
import {
  LANGUAGE_CODES,
  SUPPORTED_LANGUAGES,
  getLanguage,
  languageCodeSchema,
  pickSupportedLanguage,
} from './languages.js';

describe('SUPPORTED_LANGUAGES', () => {
  it('lists exactly the language codes', () => {
    expect(Object.keys(SUPPORTED_LANGUAGES).toSorted()).toEqual([...LANGUAGE_CODES].toSorted());
    for (const code of LANGUAGE_CODES) expect(getLanguage(code).code).toBe(code);
  });

  it('validates codes', () => {
    expect(languageCodeSchema.safeParse('de').success).toBe(true);
    expect(languageCodeSchema.safeParse('fr').success).toBe(false);
  });
});

describe('pickSupportedLanguage', () => {
  it('picks the first supported base language', () => {
    expect(pickSupportedLanguage(['fr-FR', 'de-AT', 'en-US'])).toBe('de');
    expect(pickSupportedLanguage(['EN_gb'])).toBe('en');
  });

  it('falls back to the default language', () => {
    expect(pickSupportedLanguage(['fr', 'es'])).toBe('en');
    expect(pickSupportedLanguage([])).toBe('en');
  });
});
