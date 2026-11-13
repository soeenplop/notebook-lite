import { describe, expect, it } from 'vitest';
import { joinLines, type PdfTextItem, pdfPagesToMarkdown } from './pdf-layout.js';

/** One text run per line, laid out top to bottom with the given vertical gaps. */
function page(lines: [size: number, text: string, gap?: number, x?: number][]): PdfTextItem[] {
  let y = 800;
  return lines.map(([size, str, gap = size * 1.25, x = 72]) => {
    y -= gap;
    return { str, x, y, width: str.length * size * 0.5, size, hasEOL: true };
  });
}

describe('pdfPagesToMarkdown', () => {
  it('joins text runs on one line and keeps empty pages', () => {
    const items: PdfTextItem[] = [
      { str: 'Hello', x: 72, y: 700, width: 25, size: 10, hasEOL: false },
      { str: 'world', x: 100, y: 700, width: 25, size: 10, hasEOL: false },
      { str: '1', x: 126, y: 703, width: 3, size: 6, hasEOL: true }, // footnote marker
    ];
    expect(pdfPagesToMarkdown([items, []])).toEqual(['Hello world 1', '']);
  });

  it('does not treat a large share of slightly bigger text as headings', () => {
    const body = 'A sentence that is long enough to look like regular body text in a';
    const md = pdfPagesToMarkdown([
      page([
        [10, body],
        [10, body],
        [11, body, 20],
        [11, body],
      ]),
    ]);
    expect(md[0]).not.toContain('#');
  });

  it('starts a new paragraph on column jumps and escapes Markdown syntax in body text', () => {
    const md = pdfPagesToMarkdown([
      page([
        [10, 'Left column text'],
        [10, '# not a heading', -300, 320],
      ]),
    ]);
    expect(md[0]).toBe('Left column text\n\n\\# not a heading');
  });

  it('keeps numbered list items apart', () => {
    const md = pdfPagesToMarkdown([
      page([
        [10, '1. First'],
        [10, '2. Second'],
      ]),
    ]);
    expect(md[0]).toBe('1. First\n2. Second');
  });

  it('keeps repeated edge lines of short documents', () => {
    const md = pdfPagesToMarkdown([page([[10, 'Page 1']]), page([[10, 'Page 2']])]);
    expect(md).toEqual(['Page 1', 'Page 2']);
  });
});

describe('joinLines', () => {
  it('removes hyphenation only before a lowercase continuation', () => {
    expect(joinLines('Verar-', 'beitung')).toBe('Verarbeitung');
    expect(joinLines('Nord-', 'Süd')).toBe('Nord-Süd');
    expect(joinLines('end', 'start')).toBe('end start');
    expect(joinLines('dash -', 'next')).toBe('dash - next');
  });
});
