import { describe, expect, it } from 'vitest';
import {
  createSourceFromUrlInputSchema,
  createSourceInputSchema,
  isTerminalSourceStatus,
  SOURCE_MAX_BYTES,
  sourceKindFromFileName,
  sourceStoragePath,
  STORAGE_FILE_NAME_PATTERN,
  titleFromFileName,
  toStorageFileName,
} from './sources.js';

const notebookId = '7f4c1a52-2b8e-4a83-9d4e-0d6e5c3b2a10';
const id = '0b6f2f3e-8a1d-4c55-9a0e-3d2c1b0a9f8e';

describe('sourceKindFromFileName', () => {
  it('maps supported extensions case-insensitively', () => {
    expect(sourceKindFromFileName('Report.PDF')).toBe('pdf');
    expect(sourceKindFromFileName('a.b.docx')).toBe('docx');
    expect(sourceKindFromFileName('notes.md')).toBe('md');
    expect(sourceKindFromFileName('notes.markdown')).toBe('md');
  });

  it('rejects unsupported or missing extensions', () => {
    expect(sourceKindFromFileName('slides.pptx')).toBeNull();
    expect(sourceKindFromFileName('README')).toBeNull();
    expect(sourceKindFromFileName('archive.doc')).toBeNull();
  });
});

describe('toStorageFileName', () => {
  it('produces names Storage accepts', () => {
    const cases = [
      ['Über die Brücke.pdf', 'Uber_die_Brucke.pdf'],
      ['../../etc/passwd.md', 'etc_passwd.md'],
      ['ß.md', 'file.md'],
      ['.hidden', 'hidden'],
      ['Résumé (final) v2.DOCX', 'Resume_final_v2.docx'],
    ] as const;
    for (const [input, expected] of cases) {
      const name = toStorageFileName(input);
      expect(name).toBe(expected);
      expect(name).toMatch(STORAGE_FILE_NAME_PATTERN);
    }
  });

  it('caps the length', () => {
    const name = toStorageFileName(`${'a'.repeat(500)}.pdf`);
    expect(name).toMatch(STORAGE_FILE_NAME_PATTERN);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('paths and titles', () => {
  it('builds the {user}/{notebook}/{source}/{file} path', () => {
    expect(sourceStoragePath('u', 'n', 's', 'f.md')).toBe('u/n/s/f.md');
  });

  it('derives a title from the file name', () => {
    expect(titleFromFileName('Quarterly report.pdf')).toBe('Quarterly report');
    expect(titleFromFileName('.md')).toBe('.md');
  });

  it('knows terminal statuses', () => {
    expect(isTerminalSourceStatus('ready')).toBe(true);
    expect(isTerminalSourceStatus('failed')).toBe(true);
    expect(isTerminalSourceStatus('pending')).toBe(false);
    expect(isTerminalSourceStatus('processing')).toBe(false);
  });
});

describe('createSourceInputSchema', () => {
  const valid = {
    id,
    notebookId,
    kind: 'pdf',
    title: ' Report ',
    fileName: 'Report.pdf',
    sizeBytes: 10,
  };

  it('accepts a valid upload and trims the title', () => {
    expect(createSourceInputSchema.parse(valid).title).toBe('Report');
  });

  it('rejects bad kinds, file names and sizes', () => {
    const bad = [
      { ...valid, kind: 'url' },
      { ...valid, fileName: '../x.pdf' },
      { ...valid, fileName: 'a/b.pdf' },
      { ...valid, sizeBytes: 0 },
      { ...valid, sizeBytes: SOURCE_MAX_BYTES + 1 },
      { ...valid, title: '  ' },
      { ...valid, id: 'nope' },
    ];
    for (const input of bad) expect(createSourceInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('createSourceFromUrlInputSchema', () => {
  it('accepts http(s) URLs', () => {
    expect(
      createSourceFromUrlInputSchema.parse({ notebookId, url: ' https://example.com/a?b=c ' }).url,
    ).toBe('https://example.com/a?b=c');
    expect(
      createSourceFromUrlInputSchema.safeParse({ notebookId, url: 'http://example.com' }).success,
    ).toBe(true);
  });

  it('rejects other schemes, credentials and garbage', () => {
    for (const url of [
      'ftp://example.com/x',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://user:pass@example.com/',
      'not a url',
      `https://example.com/${'a'.repeat(2100)}`,
    ]) {
      expect(createSourceFromUrlInputSchema.safeParse({ notebookId, url }).success).toBe(false);
    }
  });
});
