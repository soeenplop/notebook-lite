import type { ExtractedDocument } from '@notebook-lite/ai';
import type { FileSourceKind } from '@notebook-lite/shared';
import { LiteParse } from '@llamaindex/liteparse';
import mammoth from 'mammoth';
import { IngestError } from './errors.js';
import { firstHeading, htmlToMarkdown, normalizeMarkdown } from './markdown.js';

/** Output of an extractor: Markdown segments plus metadata for the source row. */
export interface Extraction {
  document: ExtractedDocument;
  /** Title found in the document (PDF metadata, first heading, page title), if any. */
  title: string | null;
  /** Number of pages for PDFs, null otherwise. */
  pageCount: number | null;
}

export interface ExtractOptions {
  /** Tesseract languages for OCR, the notebook language first (e.g. `['deu', 'eng']`). */
  ocrLanguages: readonly string[];
}

const NO_TEXT = 'The file contains no text.';

const EXTRACTORS: Record<
  FileSourceKind,
  (data: Uint8Array, options: ExtractOptions) => Promise<Extraction>
> = {
  pdf: (data, options) => extractPdf(data, options),
  docx: (data) => extractDocx(data),
  md: (data) => Promise.resolve(extractMarkdown(data)),
};

/** Dispatches to the extractor for a file kind. */
export function extractFile(
  kind: FileSourceKind,
  data: Uint8Array,
  options: ExtractOptions,
): Promise<Extraction> {
  return EXTRACTORS[kind](data, options);
}

/** Markdown is used as-is (UTF-8, BOM stripped, line endings normalized). */
export function extractMarkdown(data: Uint8Array): Extraction {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch (cause) {
    throw new IngestError('The Markdown file is not valid UTF-8 text.', { cause });
  }
  const markdown = normalizeMarkdown(text);
  if (!markdown) throw new IngestError(NO_TEXT);
  return {
    document: { segments: [{ text: markdown }] },
    title: firstHeading(markdown),
    pageCount: null,
  };
}

/**
 * PDF → Markdown page by page with LiteParse (PDFium): headings, lists and tables come from the
 * spatial layout, running headers and footers are dropped, and pages without a usable text layer
 * (scans, text in images) are read with Tesseract OCR. Page numbers are kept for citations.
 * Tesseract's language data comes from `TESSDATA_PREFIX` (baked into the worker image) or is
 * downloaded once on first use.
 */
export async function extractPdf(data: Uint8Array, options: ExtractOptions): Promise<Extraction> {
  const parser = new LiteParse({
    outputFormat: 'markdown',
    imageMode: 'off',
    // Link targets would only add URLs to the chunks; the link text stays.
    extractLinks: false,
    ocrLanguage: options.ocrLanguages.join('+'),
    numWorkers: 1,
    quiet: true,
  });
  let result;
  try {
    result = await parser.parse(data);
  } catch (cause) {
    // Missing OCR data is a setup problem, not a broken file: retry and log it.
    if (cause instanceof Error && /OCR failed/i.test(cause.message)) throw cause;
    throw new IngestError('The PDF could not be read. It may be damaged or password-protected.', {
      cause,
    });
  }
  const segments = result.pages
    .map((page) => ({ text: normalizeMarkdown(page.markdown), page: page.pageNum }))
    .filter((segment) => segment.text.length > 0);
  if (segments.length === 0) throw new IngestError('The PDF contains no text.');
  return {
    document: { segments },
    title: firstHeading(segments[0]?.text ?? ''),
    pageCount: result.totalPages,
  };
}

/** DOCX → HTML (mammoth, keeps headings and lists) → Markdown. */
export async function extractDocx(data: Uint8Array): Promise<Extraction> {
  let html: string;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(data) }));
  } catch (cause) {
    throw new IngestError('The DOCX file could not be read. It may be damaged.', { cause });
  }
  const markdown = htmlToMarkdown(html);
  if (!markdown) throw new IngestError(NO_TEXT);
  return {
    document: { segments: [{ text: markdown }] },
    title: firstHeading(markdown),
    pageCount: null,
  };
}
