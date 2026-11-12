import { describe, expect, it } from 'vitest';
import { extractHtml } from './html.js';

describe('extractHtml', () => {
  const article = `<!doctype html><html><head><title>Harbour News | Example</title>
    <style>body { color: red }</style><script>alert(1)</script></head>
    <body><nav><a href="/">Home</a> <a href="/about">About</a></nav>
    <article><h1>New lighthouse opens</h1>
    ${'<p>The new lighthouse on the northern cliff opened on Monday. It replaces the tower from 1890 and uses an LED lamp that is visible for twenty nautical miles, according to the harbour office. <a href="https://example.com/x">Read more</a> about the history.</p>'.repeat(4)}
    <img src="https://example.com/a.png" alt="tower"></article>
    <footer>Copyright</footer></body></html>`;

  it('extracts the main content as Markdown without scripts, images or link targets', () => {
    const result = extractHtml(article, 'https://example.com/news/1');
    const text = result.document.segments[0]?.text ?? '';
    expect(result.title).toBe('Harbour News | Example');
    expect(text).toContain('The new lighthouse on the northern cliff opened on Monday.');
    expect(text).toContain('Read more about the history.');
    expect(text).not.toContain('alert(1)');
    expect(text).not.toContain('https://example.com');
    expect(text).not.toContain('![');
    expect(text).not.toContain('Copyright');
  });

  it('falls back to the body for short pages', () => {
    const result = extractHtml(
      '<html><head><title>Short</title></head><body><p>Just one line.</p></body></html>',
      'https://example.com/',
    );
    expect(result.title).toBe('Short');
    expect(result.document.segments[0]?.text).toBe('Just one line.');
  });

  it('fails on pages without text', () => {
    expect(() =>
      extractHtml('<html><body><script>x()</script></body></html>', 'https://e.com/'),
    ).toThrow(/No readable text/);
  });
});
