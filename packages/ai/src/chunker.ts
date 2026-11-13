import { countTokens } from './tokens.js';

/**
 * Text produced by an extractor, as Markdown. PDFs yield one segment per page (with `page`);
 * other formats usually yield a single segment without a page.
 */
export interface DocumentSegment {
  text: string;
  page?: number;
}

export interface ExtractedDocument {
  segments: DocumentSegment[];
}

/** One retrieval unit; maps 1:1 to a `source_chunks` row (without the embedding). */
export interface TextChunk {
  ordinal: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  /** Markdown headings above the chunk's first own block, outermost first. */
  headingPath: string[];
  /** Offsets into {@link documentText}. */
  charStart: number;
  charEnd: number;
  tokenCount: number;
}

export interface ChunkOptions {
  /** A chunk is closed once the next block would push it past this size. */
  targetTokens?: number;
  /** Blocks larger than this are split at sentence, then word boundaries. */
  maxTokens?: number;
  /** Trailing context repeated at the start of the next chunk (not across headings). */
  overlapTokens?: number;
  /** A heading starts a new chunk once the current one has at least this many tokens. */
  minSectionTokens?: number;
}

const DEFAULTS: Required<ChunkOptions> = {
  targetTokens: 800,
  maxTokens: 1000,
  overlapTokens: 120,
  minSectionTokens: 200,
};

/** Upper bound for the context header of {@link chunkEmbeddingText}. */
const MAX_HEADER_CHARS = 300;

/**
 * The text embedded for a chunk: a short context header (source title and heading path) above
 * the content, so passages like "It costs 4 million" stay findable by their topic. Only the
 * embedding sees the header; the stored and cited content stays the plain chunk.
 */
export function chunkEmbeddingText(
  chunk: Pick<TextChunk, 'content' | 'headingPath'>,
  sourceTitle: string | null,
): string {
  const title = sourceTitle?.trim() ?? '';
  const path = chunk.headingPath[0] === title ? chunk.headingPath.slice(1) : chunk.headingPath;
  const header = [title, path.join(' > ')]
    .filter((part) => part.length > 0)
    .join('\n')
    .slice(0, MAX_HEADER_CHARS)
    .trim();
  return header ? `${header}\n\n${chunk.content}` : chunk.content;
}

/** Separator between segments in {@link documentText}. */
export const SEGMENT_SEPARATOR = '\n\n';

/** The full text that chunk offsets refer to: all segments joined. */
export function documentText(doc: ExtractedDocument): string {
  return doc.segments.map((segment) => segment.text).join(SEGMENT_SEPARATOR);
}

interface Piece {
  start: number;
  end: number;
  page: number | null;
  headingPath: string[];
  isHeading: boolean;
  tokens: number;
}

const HEADING = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^\s*(```|~~~)/;
const BLANK = /^\s*$/;

/**
 * Splits a document into overlapping, structure-aware chunks.
 *
 * Blocks (paragraphs, lists, fenced code, headings) are packed until `targetTokens`; oversized
 * blocks are split at sentence and word boundaries. Chunks may span PDF pages and record the
 * page range. Chunk content is always an exact slice of {@link documentText}.
 */
export function chunkDocument(doc: ExtractedDocument, options: ChunkOptions = {}): TextChunk[] {
  const opts = { ...DEFAULTS, ...options };
  if (opts.overlapTokens >= opts.targetTokens || opts.targetTokens > opts.maxTokens) {
    throw new Error('chunk options must satisfy overlapTokens < targetTokens <= maxTokens');
  }
  const text = documentText(doc);
  const pieces = toPieces(doc, text, opts);
  return packPieces(pieces, text, opts);
}

function toPieces(doc: ExtractedDocument, text: string, opts: Required<ChunkOptions>): Piece[] {
  const pieces: Piece[] = [];
  const headings: { level: number; title: string }[] = [];
  let offset = 0;

  for (const segment of doc.segments) {
    const page = segment.page ?? null;
    for (const block of splitBlocks(segment.text)) {
      const start = offset + block.start;
      const end = offset + block.end;
      const heading = block.isHeading ? HEADING.exec(text.slice(start, end)) : null;
      if (heading?.[1] && heading[2]) {
        const level = heading[1].length;
        while (headings.length > 0 && (headings.at(-1)?.level ?? 0) >= level) headings.pop();
        headings.push({ level, title: heading[2].trim() });
      }
      const headingPath = headings.map((h) => h.title);
      const tokens = countTokens(text.slice(start, end));
      const base = { page, headingPath, isHeading: heading !== null };

      if (tokens <= opts.maxTokens) {
        pieces.push({ ...base, start, end, tokens });
      } else {
        for (const part of splitOversized(text, start, end, opts))
          pieces.push({ ...base, ...part });
      }
    }
    offset += segment.text.length + SEGMENT_SEPARATOR.length;
  }
  return pieces;
}

/** Block ranges (trimmed, non-empty) within one segment. Headings are always their own block. */
function splitBlocks(segment: string): { start: number; end: number; isHeading: boolean }[] {
  const blocks: { start: number; end: number; isHeading: boolean }[] = [];
  let blockStart = -1;
  let blockEnd = -1;
  let inFence = false;
  let position = 0;

  const close = () => {
    if (blockStart >= 0) {
      blocks.push({ ...trimRange(segment, blockStart, blockEnd), isHeading: false });
    }
    blockStart = -1;
  };

  for (const line of segment.split('\n')) {
    const lineStart = position;
    const lineEnd = position + line.length;
    position = lineEnd + 1;

    if (!inFence && HEADING.test(line)) {
      close();
      const trimmed = trimRange(segment, lineStart, lineEnd);
      blocks.push({ ...trimmed, isHeading: true });
      continue;
    }
    if (FENCE.test(line)) inFence = !inFence;
    if (!inFence && BLANK.test(line)) {
      close();
      continue;
    }
    if (blockStart < 0) blockStart = lineStart;
    blockEnd = lineEnd;
  }
  close();

  return blocks.filter((block) => block.end > block.start);
}

/** Splits text[start, end) into ranges of at most targetTokens: sentences, then words. */
function splitOversized(
  text: string,
  start: number,
  end: number,
  opts: Required<ChunkOptions>,
): { start: number; end: number; tokens: number }[] {
  const parts: { start: number; end: number; tokens: number }[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });

  for (const sentence of segmenter.segment(text.slice(start, end))) {
    const range = trimRange(
      text,
      start + sentence.index,
      start + sentence.index + sentence.segment.length,
    );
    if (range.end <= range.start) continue;
    const tokens = countTokens(text.slice(range.start, range.end));
    if (tokens <= opts.maxTokens) {
      parts.push({ ...range, tokens });
    } else {
      parts.push(...splitWords(text, range.start, range.end, opts.targetTokens));
    }
  }
  return parts;
}

/** Greedy word windows of at most `limit` tokens; a single overlong word is cut by length. */
function splitWords(
  text: string,
  start: number,
  end: number,
  limit: number,
): { start: number; end: number; tokens: number }[] {
  const parts: { start: number; end: number; tokens: number }[] = [];
  let windowStart = -1;
  let windowEnd = -1;
  let windowTokens = 0;

  const flush = () => {
    if (windowStart >= 0) {
      parts.push({
        start: windowStart,
        end: windowEnd,
        tokens: countTokens(text.slice(windowStart, windowEnd)),
      });
    }
    windowStart = -1;
    windowTokens = 0;
  };

  for (const match of text.slice(start, end).matchAll(/\S+/g)) {
    const wordStart = start + match.index;
    const wordEnd = wordStart + match[0].length;
    const wordTokens = countTokens(match[0]);

    if (wordTokens > limit) {
      flush();
      // ~1 token per character at worst for cl100k on unusual text.
      for (let cut = wordStart; cut < wordEnd; cut += limit) {
        const cutEnd = Math.min(cut + limit, wordEnd);
        parts.push({ start: cut, end: cutEnd, tokens: countTokens(text.slice(cut, cutEnd)) });
      }
      continue;
    }
    if (windowStart >= 0 && windowTokens + wordTokens > limit) flush();
    if (windowStart < 0) windowStart = wordStart;
    windowEnd = wordEnd;
    windowTokens += wordTokens;
  }
  flush();
  return parts;
}

function packPieces(pieces: Piece[], text: string, opts: Required<ChunkOptions>): TextChunk[] {
  const chunks: TextChunk[] = [];
  let current: Piece[] = [];
  let ownFrom = 0; // index of the first piece in `current` that is not overlap
  let currentTokens = 0;

  const emit = () => {
    chunks.push(toChunk(chunks.length, current, ownFrom, text));
  };

  for (const piece of pieces) {
    const ownTokens = sumTokens(current.slice(ownFrom));
    const hasOwn = current.length > ownFrom;
    const full = currentTokens + piece.tokens > opts.targetTokens;
    const newSection = piece.isHeading && ownTokens >= opts.minSectionTokens;

    if (hasOwn && (full || newSection)) {
      emit();
      const overlap = piece.isHeading ? [] : overlapTail(current, opts.overlapTokens);
      const fits = sumTokens(overlap) + piece.tokens <= opts.maxTokens;
      current = fits ? overlap : [];
      ownFrom = current.length;
      currentTokens = sumTokens(current);
    }
    current.push(piece);
    currentTokens += piece.tokens;
  }
  if (current.length > ownFrom) emit();
  return chunks;
}

/** The longest strict suffix of `pieces` with at most `budget` tokens. */
function overlapTail(pieces: Piece[], budget: number): Piece[] {
  let tokens = 0;
  let from = pieces.length;
  while (from > 1) {
    const previous = pieces[from - 1];
    if (!previous || tokens + previous.tokens > budget) break;
    tokens += previous.tokens;
    from -= 1;
  }
  return pieces.slice(from);
}

function toChunk(ordinal: number, pieces: Piece[], ownFrom: number, text: string): TextChunk {
  const first = pieces[0];
  const last = pieces.at(-1);
  const own = pieces[ownFrom];
  if (!first || !last || !own) throw new Error('cannot build an empty chunk');

  const pages = pieces.map((piece) => piece.page).filter((page): page is number => page !== null);
  const content = text.slice(first.start, last.end);
  return {
    ordinal,
    content,
    pageStart: pages.length > 0 ? Math.min(...pages) : null,
    pageEnd: pages.length > 0 ? Math.max(...pages) : null,
    headingPath: own.headingPath,
    charStart: first.start,
    charEnd: last.end,
    tokenCount: countTokens(content),
  };
}

function sumTokens(pieces: Piece[]): number {
  return pieces.reduce((sum, piece) => sum + piece.tokens, 0);
}

function trimRange(text: string, start: number, end: number): { start: number; end: number } {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text.charAt(s))) s += 1;
  while (e > s && /\s/.test(text.charAt(e - 1))) e -= 1;
  return { start: s, end: e };
}
