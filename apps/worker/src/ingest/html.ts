import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import { IngestError } from './errors.js';
import type { Extraction } from './extractors.js';
import { firstHeading, htmlToMarkdown } from './markdown.js';

/**
 * Main content of a web page as Markdown (Readability + jsdom + Turndown). jsdom runs no
 * scripts and loads no sub-resources (its defaults), so parsing a page makes no requests.
 */
export function extractHtml(html: string, url: string): Extraction {
  // A silent console: jsdom would otherwise print CSS parse errors of arbitrary pages.
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const { document } = dom.window;
  const pageTitle = document.title.trim();
  try {
    const article = new Readability(document).parse();
    let markdown = article?.content ? htmlToMarkdown(article.content) : '';
    if (!markdown) {
      // Readability found no article (e.g. a very short page): fall back to the whole body.
      markdown = bodyMarkdown(html);
    }
    if (!markdown) throw new IngestError('No readable text was found on the page.');
    const title = article?.title?.trim() || pageTitle || firstHeading(markdown);
    return { document: { segments: [{ text: markdown }] }, title: title || null, pageCount: null };
  } finally {
    dom.window.close();
  }
}

/** Markdown of the whole `<body>` (Readability mutates its document, so this parses again). */
function bodyMarkdown(html: string): string {
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole() });
  try {
    return htmlToMarkdown(dom.window.document.body.innerHTML);
  } finally {
    dom.window.close();
  }
}
