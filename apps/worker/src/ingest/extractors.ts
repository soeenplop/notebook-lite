import type { ExtractedDocument } from '@notebook-lite/ai';
import type { FileSourceKind } from '@notebook-lite/shared';
import mammoth from 'mammoth';
import { getDocumentProxy, getMeta } from 'unpdf';
import { IngestError } from './errors.js';
import { firstHeading, htmlToMarkdown, normalizeMarkdown } from './markdown.js';
import { type PdfTextItem, pdfPagesToMarkdown } from './pdf-layout.js';

/** Output of an extractor: Markdown segments plus metadata for the source row. */
export interface Extraction {
  document: ExtractedDocument;
  /** Title found in the document (PDF metadata, first heading, page title), if any. */
  title: string | null;
  /** Number of pages for PDFs, null otherwise. */
  pageCount: number | null;
}

const NO_TEXT = 'The file contains no text.';

const EXTRACTORS: Record<FileSourceKind, (data: Uint8Array) => Promise<Extraction>> = {
  pdf: (data) => extractPdf(data),
  docx: (data) => extractDocx(data),
  md: (data) => Promise.resolve(extractMarkdown(data)),
};

/** Dispatches to the extractor for a file kind. */
export function extractFile(kind: FileSourceKind, data: Uint8Array): Promise<Extraction> {
  return EXTRACTORS[kind](data);
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
 * PDF text page by page (pdf.js via unpdf), keeping page numbers for citations. Headings,
 * paragraphs and lists are reconstructed from font sizes and positions (see `pdf-layout.ts`).
 * A PDF without any text layer (scanned) fails: OCR is out of scope.
 */
export async function extractPdf(data: Uint8Array): Promise<Extraction> {
  let pdf;
  try {
    // pdf.js may detach the buffer it is given, so it gets a copy.
    pdf = await getDocumentProxy(new Uint8Array(data), { verbosity: 0 });
  } catch (cause) {
    const message =
      cause instanceof Error && cause.name === 'PasswordException'
        ? 'The PDF is password-protected.'
        : 'The PDF could not be read. It may be damaged.';
    throw new IngestError(message, { cause });
  }
  try {
    const totalPages = pdf.numPages;
    const pages: PdfTextItem[][] = [];
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      // Pages are read one after another to keep memory flat on large PDFs.
      // oxlint-disable-next-line no-await-in-loop
      const page = await pdf.getPage(pageNumber);
      // oxlint-disable-next-line no-await-in-loop
      const content = await page.getTextContent();
      pages.push(content.items.flatMap((item) => ('str' in item ? [toTextItem(item)] : [])));
      page.cleanup();
    }
    const segments = pdfPagesToMarkdown(pages)
      .map((pageText, index) => ({ text: normalizeMarkdown(pageText), page: index + 1 }))
      .filter((segment) => segment.text.length > 0);
    if (segments.length === 0) {
      throw new IngestError(
        'The PDF contains no extractable text. Scanned PDFs (images only) are not supported.',
      );
    }
    const { info } = await getMeta(pdf);
    const metaTitle: unknown = info['Title'];
    const title = typeof metaTitle === 'string' && metaTitle.trim() ? metaTitle.trim() : null;
    return { document: { segments }, title, pageCount: totalPages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

function toTextItem(item: {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}): PdfTextItem {
  const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = item.transform;
  // Rotated or skewed text still has its font size in the transform's scale.
  const size = Math.hypot(c, d) || Math.hypot(a, b) || item.height;
  return { str: item.str, x, y, width: item.width, size, hasEOL: item.hasEOL };
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
