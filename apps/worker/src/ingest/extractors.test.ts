import { readFileSync } from 'node:fs';
import { chunkDocument } from '@notebook-lite/ai';
import { describe, expect, it } from 'vitest';
import { IngestError } from './errors.js';
import { extractDocx, extractFile, extractMarkdown, extractPdf } from './extractors.js';
import { firstHeading, htmlToMarkdown } from './markdown.js';

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url)));
}

describe('extractMarkdown', () => {
  it('reads Markdown as-is and takes the first heading as title', () => {
    const result = extractMarkdown(fixture('notes.md'));
    expect(result.title).toBe('Harbour Notes');
    expect(result.pageCount).toBeNull();
    const [segment] = result.document.segments;
    expect(segment?.page).toBeUndefined();
    expect(segment?.text.startsWith('# Harbour Notes')).toBe(true); // BOM stripped
    expect(segment?.text).toContain('- Opens at 5 am');
  });

  it('normalizes line endings', () => {
    const result = extractMarkdown(
      new TextEncoder().encode('Line one\r\n\r\n\r\n\r\nLine two  \r\n'),
    );
    expect(result.document.segments[0]?.text).toBe('Line one\n\nLine two');
    expect(result.title).toBeNull();
  });

  it('fails on empty files and invalid UTF-8', () => {
    expect(() => extractMarkdown(new TextEncoder().encode(' \n\n '))).toThrow(IngestError);
    expect(() => extractMarkdown(new Uint8Array([0xff, 0xfe, 0xfd]))).toThrow(/UTF-8/);
  });
});

describe('extractPdf', () => {
  it('extracts text page by page with page numbers and the metadata title', async () => {
    const result = await extractPdf(fixture('two-pages.pdf'));
    expect(result.title).toBe('Harbour Chronicle');
    expect(result.pageCount).toBe(2);
    expect(result.document.segments).toEqual([
      { text: 'The lighthouse was built in 1890. It stands on the northern cliff.', page: 1 },
      { text: 'Fishermen sell their catch at dawn.', page: 2 },
    ]);
  });

  it('reconstructs headings, paragraphs and lists and drops running footers', async () => {
    const result = await extractPdf(fixture('structured.pdf'));
    expect(result.pageCount).toBe(3);
    expect(result.document.segments).toEqual([
      {
        text: [
          '# Harbour Report',
          '## Overview',
          'The harbour was founded in 1850 and has grown steadily ever since. Its construction took almost twenty years and involved hundreds of local workers from the surrounding villages.',
          'Today the harbour serves fishermen, ferries and a growing number of sailing boats during the summer months.',
          '## Facilities',
          '- Lighthouse on the northern cliff\n- Fish market at the old pier',
        ].join('\n\n'),
        page: 1,
      },
      {
        text: '## Budget\n\n### Costs in detail\n\nThe renovation of the pier is expected to cost 4.2 million euros, most of which is covered by regional funds.',
        page: 2,
      },
      {
        text: 'Maintenance is planned every five years and is financed by mooring fees paid by the boat owners.',
        page: 3,
      },
    ]);
    const chunks = chunkDocument(result.document, {
      targetTokens: 40,
      maxTokens: 60,
      overlapTokens: 10,
      minSectionTokens: 1,
    });
    expect(chunks.at(-1)?.headingPath).toEqual(['Harbour Report', 'Budget', 'Costs in detail']);
  });

  it('keeps page ranges through chunking', async () => {
    const { document } = await extractPdf(fixture('two-pages.pdf'));
    const chunks = chunkDocument(document);
    expect(chunks[0]?.pageStart).toBe(1);
    expect(chunks.at(-1)?.pageEnd).toBe(2);
  });

  it('fails clearly on scanned PDFs without a text layer', async () => {
    await expect(extractPdf(fixture('scanned.pdf'))).rejects.toThrow(/no extractable text/);
  });

  it('fails clearly on damaged files', async () => {
    await expect(extractPdf(new TextEncoder().encode('not a pdf'))).rejects.toThrow(
      /could not be read/,
    );
  });
});

describe('extractDocx', () => {
  it('converts headings, paragraphs and emphasis to Markdown', async () => {
    const result = await extractDocx(fixture('report.docx'));
    expect(result.title).toBe('Project Overview');
    expect(result.pageCount).toBeNull();
    expect(result.document.segments).toEqual([
      {
        text: '# Project Overview\n\nThe harbour project started in 2024.\n\n## Budget\n\nTotal cost: **4.2 million**',
      },
    ]);
  });

  it('fails on empty and damaged documents', async () => {
    await expect(extractDocx(fixture('empty.docx'))).rejects.toThrow(/contains no text/);
    await expect(extractDocx(new TextEncoder().encode('PK nope'))).rejects.toThrow(
      /could not be read/,
    );
  });
});

describe('extractFile', () => {
  it('dispatches by kind', async () => {
    await expect(extractFile('md', fixture('notes.md'))).resolves.toMatchObject({
      title: 'Harbour Notes',
    });
    await expect(extractFile('pdf', fixture('two-pages.pdf'))).resolves.toMatchObject({
      pageCount: 2,
    });
    await expect(extractFile('docx', fixture('report.docx'))).resolves.toMatchObject({
      title: 'Project Overview',
    });
  });
});

describe('markdown helpers', () => {
  it('finds the first heading without emphasis markers', () => {
    expect(firstHeading('intro\n\n## **Bold** title ##\n# Later')).toBe('Bold title');
    expect(firstHeading('no headings')).toBeNull();
  });

  it('converts lists and drops svg', () => {
    expect(htmlToMarkdown('<ul><li>a</li><li>b</li></ul><svg><text>x</text></svg>')).toBe(
      '-   a\n-   b',
    );
  });
});
