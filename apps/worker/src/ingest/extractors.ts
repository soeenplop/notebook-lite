import type { ExtractedDocument } from '@notebook-lite/ai';
import type { FileSourceKind } from '@notebook-lite/shared';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy, getMeta } from 'unpdf';
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
 * PDF text page by page (pdf.js via unpdf), keeping page numbers for citations. A PDF without
 * any text layer (scanned) fails: OCR is out of scope.
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
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const segments = text
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
