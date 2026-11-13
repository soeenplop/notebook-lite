import TurndownService from 'turndown';

/**
 * HTML → Markdown for DOCX (via mammoth) and web pages (via Readability). Keeps headings,
 * lists, tables-as-text and emphasis; drops images, scripts and link targets (the link text
 * stays), so chunks contain readable prose rather than URLs.
 */
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
});
turndown.remove(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'canvas']);
turndown.remove((node) => node.nodeName.toLowerCase() === 'svg');
turndown.addRule('dropImages', { filter: ['img', 'picture'], replacement: () => '' });
turndown.addRule('linkText', { filter: 'a', replacement: (content) => content });

export function htmlToMarkdown(html: string): string {
  return normalizeMarkdown(turndown.turndown(html));
}

/** Unifies line endings, trims trailing spaces and collapses runs of blank lines. */
export function normalizeMarkdown(text: string): string {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const HEADING = /^#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/m;

/** The text of the first Markdown heading, without inline emphasis markers. */
export function firstHeading(markdown: string): string | null {
  const match = HEADING.exec(markdown);
  const title = match?.[1]?.replace(/[*_`]/g, '').trim();
  return title ? title : null;
}
