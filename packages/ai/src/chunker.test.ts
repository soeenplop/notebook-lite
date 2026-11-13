import { describe, expect, it } from 'vitest';
import { chunkDocument, documentText, type ExtractedDocument } from './chunker.js';
import { countTokens } from './tokens.js';

/** A paragraph of `words` words (about two tokens each). */
function paragraph(label: string, words: number): string {
  return `${label}: ${Array.from({ length: words }, (_, i) => `word${i % 50}`).join(' ')}.`;
}

describe('chunkDocument', () => {
  it('returns no chunks for an empty document', () => {
    expect(chunkDocument({ segments: [] })).toEqual([]);
    expect(chunkDocument({ segments: [{ text: '  \n\n ' }] })).toEqual([]);
  });

  it('keeps a short document in one chunk with exact offsets', () => {
    const doc: ExtractedDocument = {
      segments: [{ text: '# Title\n\nFirst paragraph.\n\nSecond.' }],
    };
    const [chunk, ...rest] = chunkDocument(doc);

    expect(rest).toEqual([]);
    expect(chunk).toMatchObject({
      ordinal: 0,
      content: '# Title\n\nFirst paragraph.\n\nSecond.',
      pageStart: null,
      pageEnd: null,
      headingPath: ['Title'],
      charStart: 0,
    });
    expect(chunk?.content).toBe(documentText(doc).slice(chunk?.charStart, chunk?.charEnd));
    expect(chunk?.tokenCount).toBe(countTokens(chunk?.content ?? ''));
  });

  it('packs blocks up to the target size and overlaps consecutive chunks', () => {
    const blocks = Array.from({ length: 12 }, (_, i) => paragraph(`P${i}`, 60));
    const doc: ExtractedDocument = { segments: [{ text: blocks.join('\n\n') }] };
    const chunks = chunkDocument(doc, { targetTokens: 300, maxTokens: 400, overlapTokens: 150 });

    expect(chunks.length).toBeGreaterThan(2);
    const text = documentText(doc);
    for (const [i, chunk] of chunks.entries()) {
      expect(chunk.ordinal).toBe(i);
      expect(chunk.content).toBe(text.slice(chunk.charStart, chunk.charEnd));
      expect(chunk.tokenCount).toBeLessThanOrEqual(400);
    }
    for (let i = 1; i < chunks.length; i += 1) {
      const previous = chunks[i - 1];
      const chunk = chunks[i];
      // overlap: the next chunk starts inside the previous one, but moves forward
      expect(chunk?.charStart).toBeLessThan(previous?.charEnd ?? 0);
      expect(chunk?.charStart).toBeGreaterThan(previous?.charStart ?? 0);
    }
    expect(chunks.at(-1)?.charEnd).toBe(text.length);
  });

  it('tracks nested heading paths and starts sections without overlap', () => {
    const text = [
      '# Guide',
      paragraph('intro', 120),
      '## Install',
      paragraph('install', 120),
      '### Linux',
      paragraph('linux', 120),
      '## Usage',
      paragraph('usage', 120),
    ].join('\n\n');
    const chunks = chunkDocument({ segments: [{ text }] }, { minSectionTokens: 50 });

    expect(chunks.map((chunk) => chunk.headingPath)).toEqual([
      ['Guide'],
      ['Guide', 'Install'],
      ['Guide', 'Install', 'Linux'],
      ['Guide', 'Usage'],
    ]);
    expect(chunks[3]?.content.startsWith('## Usage')).toBe(true);
  });

  it('records page ranges across PDF pages', () => {
    const doc: ExtractedDocument = {
      segments: [1, 2, 3, 4].map((page) => ({ text: paragraph(`page${page}`, 60), page })),
    };
    const chunks = chunkDocument(doc, { targetTokens: 300, maxTokens: 400, overlapTokens: 0 });

    expect(chunks.map((chunk) => [chunk.pageStart, chunk.pageEnd])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('splits oversized blocks at sentence and word boundaries', () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Sentence ${i} ${paragraph('s', 40)}`);
    const longWordless = Array.from({ length: 900 }, (_, i) => `w${i}`).join(' ');
    const doc: ExtractedDocument = {
      segments: [{ text: `${sentences.join(' ')}\n\n${longWordless}` }],
    };
    const chunks = chunkDocument(doc, { targetTokens: 300, maxTokens: 400, overlapTokens: 50 });

    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(400);
  });

  it('does not split sentences at abbreviations', () => {
    const block = Array.from(
      { length: 40 },
      (_, i) =>
        `Satz ${i}: Dr. Müller nannte z. B. Häfen, e.g. Kiel und Prof. J. Smith stimmte zu.`,
    ).join(' ');
    const chunks = chunkDocument(
      { segments: [{ text: block }] },
      { targetTokens: 60, maxTokens: 80, overlapTokens: 0, minSectionTokens: 1 },
    );
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.content).toMatch(/^Satz \d+:/);
      expect(chunk.content).toMatch(/stimmte zu\.$/);
    }
  });

  it('merges a tiny final chunk into the previous one of the same section', () => {
    // Three ~64-token paragraphs fill each chunk (one of them overlap); the tail spills over.
    const tail = 'The tail sentence has a few extra words.';
    const blocks = Array.from({ length: 9 }, (_, i) => paragraph(`P${i}`, 30));
    const text = [...blocks, tail].join('\n\n');
    const options = { targetTokens: 200, maxTokens: 400, overlapTokens: 70, minSectionTokens: 50 };
    const chunks = chunkDocument({ segments: [{ text }] }, options);

    const last = chunks.at(-1);
    expect(last?.content).toMatch(/^P6:[\s\S]*P8:[\s\S]*extra words\.$/);
    expect(last?.charEnd).toBe(text.length);
    expect(last?.tokenCount).toBeLessThanOrEqual(options.maxTokens);
    // Without the merge (tail threshold 1 token) the tail is a chunk of its own.
    const unmerged = chunkDocument({ segments: [{ text }] }, { ...options, minSectionTokens: 1 });
    expect(unmerged).toHaveLength(chunks.length + 1);
    expect(unmerged.at(-1)?.content).toMatch(/^P8:/);
  });

  it('does not split inside fenced code blocks', () => {
    const code = '```ts\nconst a = 1;\n\nconst b = 2;\n```';
    const chunks = chunkDocument({ segments: [{ text: `Intro.\n\n${code}` }] });
    expect(chunks[0]?.content).toContain(code);
  });

  it('rejects inconsistent options', () => {
    expect(() =>
      chunkDocument({ segments: [] }, { targetTokens: 100, overlapTokens: 100 }),
    ).toThrow(/overlapTokens < targetTokens/);
    expect(() => chunkDocument({ segments: [] }, { targetTokens: 500, maxTokens: 400 })).toThrow(
      /targetTokens <= maxTokens/,
    );
  });
});
