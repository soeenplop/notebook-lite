import { splitCitations } from '@notebook-lite/shared';
import type { ElementContent, Nodes, Root, RootContent } from 'hast';

/** Data attribute that carries a citation group's markers (`"1,2"`) on the rendered `span`. */
export const CITATION_ATTRIBUTE = 'data-citation';

/** Elements whose text is left alone: markers there are code, not citations. */
const SKIPPED_ELEMENTS = new Set(['code', 'pre']);

/**
 * Rehype plugin: turns `[n]` markers in text nodes into citation spans (`<span data-citation="1,2">`)
 * that the markdown renderer swaps for chips. Markers not in `validMarkers` (invalid, or still
 * streaming) are dropped. Runs after Streamdown's sanitizer, which would strip the data attribute.
 */
export function rehypeCitations(validMarkers: ReadonlySet<number>) {
  return (tree: Root) => {
    transform(tree, validMarkers);
  };
}

function transform(node: Nodes, validMarkers: ReadonlySet<number>): void {
  if (!('children' in node)) return;
  if (node.type === 'element' && SKIPPED_ELEMENTS.has(node.tagName)) return;
  const children: RootContent[] = [];
  for (const child of node.children) {
    if (child.type !== 'text') {
      transform(child, validMarkers);
      children.push(child);
      continue;
    }
    for (const segment of splitCitations(child.value, validMarkers)) {
      children.push(
        segment.type === 'text'
          ? { type: 'text', value: segment.text }
          : {
              type: 'element',
              tagName: 'span',
              properties: { dataCitation: segment.markers.join(',') },
              children: [],
            },
      );
    }
  }
  if (node.type === 'root') node.children = children;
  else node.children = children.filter(isElementContent);
}

function isElementContent(node: RootContent): node is ElementContent {
  return node.type !== 'doctype';
}

/** Markers of a rendered citation span (`"1,2"` → `[1, 2]`). */
export function parseCitationAttribute(value: unknown): number[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((part) => Number.parseInt(part, 10))
    .filter((marker) => Number.isInteger(marker));
}
