/**
 * Rebuilds Markdown structure (headings, paragraphs, lists) from positioned PDF text.
 *
 * pdf.js only returns text runs with a font size and a position, in content-stream order. The
 * heuristics here turn them into lines, drop running headers/footers, map larger fonts to
 * headings, split paragraphs at larger vertical gaps and join wrapped lines (removing
 * end-of-line hyphenation). Multi-column layouts work as far as the content stream is in
 * reading order; tables stay plain text.
 */

/** One text run of a page; `x`/`y` in PDF user space (y grows upwards). */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  /** Font size in user-space units. */
  size: number;
  hasEOL: boolean;
}

interface Line {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
}

/** Lines closer than this fraction of the font size are one visual line (sub/superscripts). */
const SAME_LINE = 0.5;
/** A font at least this much larger than the body font is a heading… */
const HEADING_RATIO = 1.08;
/** …unless it carries this much text relative to the body (then it is body text, too). */
const MAX_HEADING_SHARE = 0.5;
const MAX_HEADING_LENGTH = 120;
const MAX_HEADING_LEVEL = 6;
/** A vertical gap this much larger than the usual line gap starts a new paragraph. */
const PARAGRAPH_GAP = 1.4;
/** A line ending a sentence that is shorter than this fraction of the page width ends a paragraph. */
const SHORT_LINE = 0.75;
/** Lines repeated at the top/bottom of at least this share of pages are headers/footers. */
const RUNNING_SHARE = 0.5;
const RUNNING_MIN_PAGES = 3;
const RUNNING_EDGE_LINES = 2;

const BULLET = /^(?:[•●▪◦‣∙·*–-]|\d{1,3}[.)])\s+/;
const SYMBOL_BULLET = /^[•●▪◦‣∙·*–-]\s+/;
const SENTENCE_END = /[.!?:;]["'”’)]?$/;
const HYPHENATED = /[\p{Ll}\p{Lu}]-$/u;
const STARTS_LOWERCASE = /^\p{Ll}/u;

/** Markdown for each page (same order and length as `pages`; empty pages yield ''). */
export function pdfPagesToMarkdown(pages: PdfTextItem[][]): string[] {
  const linesPerPage = dropRunningLines(pages.map(toLines));
  const allLines = linesPerPage.flat();
  if (allLines.length === 0) return pages.map(() => '');

  const bodySize = dominantSize(allLines);
  const headingLevels = headingLevelsBySize(allLines, bodySize);
  const lineGap = typicalLineGap(linesPerPage, bodySize);

  return linesPerPage.map((lines) => pageToMarkdown(lines, { bodySize, headingLevels, lineGap }));
}

/** Groups text runs into visual lines. */
function toLines(items: PdfTextItem[]): Line[] {
  const lines: Line[] = [];
  let current: { line: Line; end: number; sizeChars: Map<number, number> } | null = null;

  const flush = () => {
    if (current) {
      const text = current.line.text.replace(/\s+/g, ' ').trim();
      if (text) {
        lines.push({
          ...current.line,
          text,
          width: current.end - current.line.x,
          size: mostFrequent(current.sizeChars),
        });
      }
    }
    current = null;
  };

  for (const item of items) {
    if (item.str && current) {
      const tolerance = Math.max(current.line.size, item.size) * SAME_LINE;
      if (Math.abs(item.y - current.line.y) > tolerance) flush();
    }
    if (item.str) {
      if (!current) {
        current = {
          line: { text: '', x: item.x, y: item.y, width: 0, size: item.size },
          end: item.x,
          sizeChars: new Map(),
        };
      } else {
        const gap = item.x - current.end;
        const spaced = /\s$/.test(current.line.text) || /^\s/.test(item.str);
        if (!spaced && gap > item.size * 0.15) current.line.text += ' ';
      }
      current.line.text += item.str;
      current.end = Math.max(current.end, item.x + item.width);
      const size = roundSize(item.size);
      const chars = item.str.replace(/\s/g, '').length;
      current.sizeChars.set(size, (current.sizeChars.get(size) ?? 0) + chars);
      current.line.size = mostFrequent(current.sizeChars);
    }
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

/** Removes lines (page numbers, running titles) repeated at the edges of many pages. */
function dropRunningLines(pages: Line[][]): Line[][] {
  if (pages.length < RUNNING_MIN_PAGES) return pages;
  const key = (line: Line) => line.text.replace(/\d+/g, '#').toLowerCase();
  const edges = (lines: Line[]) =>
    new Set([...lines.slice(0, RUNNING_EDGE_LINES), ...lines.slice(-RUNNING_EDGE_LINES)]);

  const pageCounts = new Map<string, number>();
  for (const lines of pages) {
    for (const k of new Set([...edges(lines)].map(key))) {
      pageCounts.set(k, (pageCounts.get(k) ?? 0) + 1);
    }
  }
  const threshold = Math.max(RUNNING_MIN_PAGES, pages.length * RUNNING_SHARE);
  return pages.map((lines) => {
    const edgeLines = edges(lines);
    return lines.filter(
      (line) => !edgeLines.has(line) || (pageCounts.get(key(line)) ?? 0) < threshold,
    );
  });
}

/** Characters per font size. */
function charsBySize(lines: Line[]): Map<number, number> {
  const chars = new Map<number, number>();
  for (const line of lines) chars.set(line.size, (chars.get(line.size) ?? 0) + line.text.length);
  return chars;
}

/** The font size carrying the most characters: the body text. */
function dominantSize(lines: Line[]): number {
  return mostFrequent(charsBySize(lines));
}

/** Heading level per font size: the largest heading font is level 1. */
function headingLevelsBySize(lines: Line[], bodySize: number): Map<number, number> {
  const chars = charsBySize(lines);
  const bodyChars = chars.get(bodySize) ?? 0;
  const sizes = [
    ...new Set(lines.filter((l) => isHeadingCandidate(l, bodySize)).map((l) => l.size)),
  ].filter((size) => (chars.get(size) ?? 0) <= bodyChars * MAX_HEADING_SHARE);
  sizes.sort((a, b) => b - a);
  return new Map(sizes.map((size, i) => [size, Math.min(i + 1, MAX_HEADING_LEVEL)]));
}

function isHeadingCandidate(line: Line, bodySize: number): boolean {
  return (
    line.size >= bodySize * HEADING_RATIO &&
    line.text.length <= MAX_HEADING_LENGTH &&
    /\p{L}/u.test(line.text)
  );
}

/** Median distance between consecutive body lines (fallback: 1.2 × font size). */
function typicalLineGap(pages: Line[][], bodySize: number): number {
  const gaps: number[] = [];
  for (const lines of pages) {
    for (let i = 1; i < lines.length; i += 1) {
      const previous = lines[i - 1];
      const line = lines[i];
      if (!previous || !line || previous.size !== bodySize || line.size !== bodySize) continue;
      const gap = previous.y - line.y;
      if (gap > 0 && gap < bodySize * 3) gaps.push(gap);
    }
  }
  if (gaps.length === 0) return bodySize * 1.2;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? bodySize * 1.2;
}

interface Layout {
  bodySize: number;
  headingLevels: Map<number, number>;
  lineGap: number;
}

function pageToMarkdown(lines: Line[], layout: Layout): string {
  const blocks: string[] = [];
  /** Logical lines of the open paragraph or list. */
  let paragraph: string[] = [];
  // Widened explicitly: TS does not track the reassignments inside the closures below.
  let heading = null as { level: number; text: string; line: Line } | null;
  let previous: Line | null = null;

  const bodyLines = lines.filter((line) => !layout.headingLevels.has(line.size));
  const pageWidth = Math.max(0, ...bodyLines.map((line) => line.width));
  const judgeShortLines = bodyLines.length >= 4;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push(escapeBlock(paragraph.join('\n')));
    paragraph = [];
  };
  const flushHeading = () => {
    if (heading) blocks.push(`${'#'.repeat(heading.level)} ${heading.text}`);
    heading = null;
  };

  for (const line of lines) {
    const gap = previous ? previous.y - line.y : 0;
    const level = layout.headingLevels.get(line.size);

    if (level !== undefined) {
      flushParagraph();
      const continues =
        heading?.level === level && gap > 0 && gap <= line.size * 1.6 && previous === heading.line;
      if (heading && continues) {
        heading = { level, text: joinLines(heading.text, line.text), line };
      } else {
        flushHeading();
        heading = { level, text: line.text, line };
      }
      previous = line;
      continue;
    }
    flushHeading();

    const isBullet = BULLET.test(line.text);
    const startsBlock =
      previous === null ||
      layout.headingLevels.has(previous.size) ||
      gap <= 0 ||
      gap > layout.lineGap * PARAGRAPH_GAP ||
      Math.abs(line.size - previous.size) > layout.bodySize * 0.15 ||
      (judgeShortLines &&
        SENTENCE_END.test(previous.text) &&
        previous.width < pageWidth * SHORT_LINE);

    const text = line.text.replace(SYMBOL_BULLET, '- ');
    const last = paragraph.at(-1);
    if (isBullet) {
      // Consecutive list items stay in one block; a gap or new section still splits.
      const inList = last !== undefined && BULLET.test(paragraph[0] ?? '');
      if (!inList || (startsBlock && gap > layout.lineGap * PARAGRAPH_GAP)) flushParagraph();
      paragraph.push(text);
    } else if (startsBlock || last === undefined) {
      flushParagraph();
      paragraph.push(text);
    } else {
      paragraph[paragraph.length - 1] = joinLines(last, text);
    }
    previous = line;
  }
  flushParagraph();
  flushHeading();
  return blocks.join('\n\n');
}

/** Joins a wrapped line, undoing end-of-line hyphenation ("Verar-" + "beitung"). */
export function joinLines(first: string, second: string): string {
  if (HYPHENATED.test(first)) {
    return STARTS_LOWERCASE.test(second) ? first.slice(0, -1) + second : first + second;
  }
  return `${first} ${second}`;
}

/** Keeps body text from being read as a Markdown heading or code fence by the chunker. */
function escapeBlock(text: string): string {
  return text.replace(/^(#{1,6}[ \t]|```|~~~)/gm, '\\$1');
}

function roundSize(size: number): number {
  return Math.round(size * 2) / 2;
}

function mostFrequent(counts: Map<number, number>): number {
  let best = 0;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}
