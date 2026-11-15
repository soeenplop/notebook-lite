import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CitationText } from './citation-text';

const citation = {
  marker: 1,
  chunkId: '5e4d3c2b-1a09-4f8e-8d7c-6b5a49382716',
  sourceId: '0b0c6d1e-3f4a-4b5c-8d6e-7f8091a2b3c4',
  sourceTitle: 'Paper',
  page: 3,
  quote: 'Water boils at 100 °C.',
};

function render(text: string): string {
  return renderToStaticMarkup(
    <CitationText text={text} citations={new Map([[1, citation]])} onSelect={() => {}} />,
  );
}

describe('CitationText', () => {
  it('renders markdown formatting', () => {
    const html = render('Intro with **bold** and *em*:\n\n- one [1]\n- two\n\n1. first\n2. second');
    expect(html).toContain('data-streamdown="strong">bold</span>');
    expect(html).toContain('<em>em</em>');
    expect(html).toMatch(/<ul[^>]*>.*<li[^>]*>one/s);
    expect(html).toContain('<ol');
  });

  it('renders valid markers as chips and drops invalid ones', () => {
    const html = render('Boils at 100 °C [1][7]. Inside **bold [1]** too.');
    expect(html.match(/aria-label="Citation 1: Paper, p\. 3"/g)).toHaveLength(2);
    expect(html).not.toContain('[1]');
    expect(html).not.toContain('[7]');
    expect(html).not.toContain('>7<');
    expect(html).not.toContain('data-citation');
  });

  it('leaves markers in code alone', () => {
    const html = render('Use `arr[1]` here [1].');
    expect(html).toContain('data-streamdown="inline-code">arr[1]</code>');
    expect(html.match(/aria-label="Citation 1/g)).toHaveLength(1);
  });

  it('renders no raw html and no images', () => {
    const html = render('<b>x</b> ![a](https://evil.example/p.png) [link](https://example.com)');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<img');
    // Links open only after Streamdown's confirmation dialog.
    expect(html).toContain('data-streamdown="link"');
    expect(html).not.toContain('href=');
  });
});
