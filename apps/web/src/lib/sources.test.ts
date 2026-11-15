import { SOURCE_MAX_BYTES } from '@notebook-lite/shared';
import { describe, expect, it } from 'vitest';
import { describeSource, formatBytes, planUpload, sourcesRefetchInterval } from './sources';

describe('planUpload', () => {
  it('derives kind, Storage-safe file name and title', () => {
    expect(planUpload({ name: 'Über uns.PDF', size: 10 })).toEqual({
      ok: true,
      kind: 'pdf',
      fileName: 'Uber_uns.pdf',
      title: 'Über uns',
    });
  });

  it('rejects unsupported, empty and oversized files', () => {
    expect(planUpload({ name: 'slides.pptx', size: 10 })).toMatchObject({ ok: false });
    expect(planUpload({ name: 'a.md', size: 0 })).toEqual({ ok: false, error: 'a.md is empty' });
    expect(planUpload({ name: 'a.pdf', size: SOURCE_MAX_BYTES + 1 })).toEqual({
      ok: false,
      error: 'a.pdf is larger than 25 MB',
    });
  });
});

describe('sourcesRefetchInterval', () => {
  it('polls only while a source is pending or processing', () => {
    expect(sourcesRefetchInterval(undefined)).toBe(false);
    expect(sourcesRefetchInterval([{ status: 'ready' }, { status: 'failed' }])).toBe(false);
    expect(sourcesRefetchInterval([{ status: 'ready' }, { status: 'pending' }])).toBe(3000);
    expect(sourcesRefetchInterval([{ status: 'processing' }], 500)).toBe(500);
  });
});

describe('describeSource', () => {
  it('summarizes files and web pages', () => {
    expect(
      describeSource({ kind: 'pdf', originalUrl: null, pageCount: 12, sizeBytes: 1_300_000 }),
    ).toBe('PDF · 12 pages · 1.2 MB');
    expect(
      describeSource({ kind: 'md', originalUrl: null, pageCount: null, sizeBytes: 2048 }),
    ).toBe('Markdown · 2 KB');
    expect(
      describeSource({
        kind: 'url',
        originalUrl: 'https://www.example.com/a',
        pageCount: null,
        sizeBytes: 10,
      }),
    ).toBe('Web page · www.example.com');
  });

  it('formats sizes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB');
  });
});
