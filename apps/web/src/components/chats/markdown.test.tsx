import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

function render(text: string): string {
  return renderToStaticMarkup(<Markdown text={text} />);
}

describe('Markdown', () => {
  it('renders markdown formatting', () => {
    const html = render(
      '# Title\n\nText with **bold**:\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |',
    );
    expect(html).toContain('<h3');
    expect(html).toContain('data-streamdown="strong">bold</span>');
    expect(html).toMatch(/<ul[^>]*>.*<li[^>]*>one/s);
    expect(html).toContain('<table');
  });

  it('does not render raw HTML or images', () => {
    const html = render('<script>alert(1)</script><b>raw</b>\n\n![x](https://evil.example/x.png)');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('evil.example');
  });
});
