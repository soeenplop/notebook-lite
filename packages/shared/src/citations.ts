import { z } from 'zod';

/**
 * Citations in grounded chat answers. The model numbers every statement with markers that point
 * at the retrieved excerpts: `[1]`, `[1][2]` or `[1, 2]`. The API sends the marker → excerpt map
 * as a `data-citations` part before the answer text and stores a snapshot of the markers used in
 * `messages.citations`, so citations survive the deletion of their source.
 */

/** Characters of chunk text kept as the quote in a citation (hover preview, snapshot). */
export const CITATION_QUOTE_MAX_LENGTH = 400;

export const citationSchema = z.object({
  /** The number the model writes in brackets, 1-based. */
  marker: z.number().int().min(1),
  chunkId: z.uuid(),
  sourceId: z.uuid(),
  sourceTitle: z.string(),
  /** First page of the excerpt (PDFs); null for sources without pages. */
  page: z.number().int().min(1).nullable(),
  /** The excerpt text (shortened to {@link CITATION_QUOTE_MAX_LENGTH}), in the source language. */
  quote: z.string(),
});
export type Citation = z.infer<typeof citationSchema>;

export const citationListSchema = z.array(citationSchema);

/** One run of answer text, or a group of adjacent citation markers. */
export type CitationSegment =
  { type: 'text'; text: string } | { type: 'citation'; markers: number[] };

// `[1]`, `[1, 2]`, `[1,2,3]`: one bracket with one or more comma-separated numbers.
const MARKER_GROUP = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

function parseNumbers(group: string): number[] {
  return group
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 1);
}

/** Cuts a chunk text down to a citation quote (whitespace collapsed, ellipsis when shortened). */
export function toCitationQuote(content: string, maxLength = CITATION_QUOTE_MAX_LENGTH): string {
  const text = content.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** All markers in `text`, unique, in order of first appearance. */
export function extractCitationMarkers(text: string): number[] {
  const seen = new Set<number>();
  for (const match of text.matchAll(MARKER_GROUP)) {
    for (const marker of parseNumbers(match[1] ?? '')) seen.add(marker);
  }
  return [...seen];
}

/**
 * Splits answer text into text runs and citation groups for rendering. Adjacent marker brackets
 * (`[1][2]`, `[1] [2]`) form one group; markers not in `validMarkers` (when given) are dropped,
 * and a bracket left without valid markers disappears together with the space before it.
 */
export function splitCitations(
  text: string,
  validMarkers?: ReadonlySet<number>,
): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let cursor = 0;

  const pushText = (value: string) => {
    if (!value) return;
    const last = segments.at(-1);
    if (last?.type === 'text') last.text += value;
    else segments.push({ type: 'text', text: value });
  };

  for (const match of text.matchAll(MARKER_GROUP)) {
    const start = match.index;
    const before = text.slice(cursor, start);
    const markers = parseNumbers(match[1] ?? '').filter(
      (marker) => !validMarkers || validMarkers.has(marker),
    );
    cursor = start + match[0].length;

    const last = segments.at(-1);
    if (markers.length === 0) {
      // Drop the invalid bracket and the whitespace that only separated it from the text.
      pushText(/\S/.test(before) ? before.replace(/[ \t]+$/, '') : '');
      continue;
    }
    if (last?.type === 'citation' && !/\S/.test(before)) {
      for (const marker of markers) if (!last.markers.includes(marker)) last.markers.push(marker);
      continue;
    }
    pushText(before);
    segments.push({ type: 'citation', markers: [...new Set(markers)] });
  }
  pushText(text.slice(cursor));
  return segments;
}

/**
 * Rewrites `text` so it only contains markers from `validMarkers` (normalized to `[n]` brackets).
 * Used before persisting an answer: the model sometimes cites excerpts that do not exist.
 */
export function sanitizeCitations(text: string, validMarkers: ReadonlySet<number>): string {
  return splitCitations(text, validMarkers)
    .map((segment) =>
      segment.type === 'text' ? segment.text : segment.markers.map((m) => `[${m}]`).join(''),
    )
    .join('');
}

/**
 * Grounding check: sentences of an answer that carry no citation marker. Headings, list
 * introductions (ending in `:`) and very short fragments are ignored. Markers placed after the
 * sentence punctuation (`… end. [1]`) count for the sentence before them.
 */
export function findUncitedSentences(text: string): string[] {
  // Move markers that follow the punctuation in front of it: "end. [1]" -> "end [1]."
  const normalized = text.replace(
    /([.!?])((?:\s*\[\d{1,3}(?:\s*,\s*\d{1,3})*\])+)/g,
    (_match, punctuation: string, markers: string) => `${markers}${punctuation}`,
  );
  return normalized
    .split(/\n+|(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/^[\s>*#-]+|^\d+\.\s+/, '').trim())
    .filter((sentence) => sentence.length >= 20 && !sentence.endsWith(':'))
    .filter((sentence) => extractCitationMarkers(sentence).length === 0);
}
