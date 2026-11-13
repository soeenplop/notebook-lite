'use client';

import type { Citation } from '@notebook-lite/shared';
import { type ComponentProps, createContext, use, useMemo } from 'react';
import {
  type Components,
  defaultRehypePlugins,
  Streamdown,
  type StreamdownProps,
} from 'streamdown';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import {
  CITATION_ATTRIBUTE,
  parseCitationAttribute,
  rehypeCitations,
} from '@/lib/rehype-citations';

/**
 * Elements the answer may not render: images could load arbitrary URLs (data exfiltration). Links
 * go through Streamdown's confirmation dialog.
 */
const DISALLOWED_ELEMENTS = ['img'];

/**
 * Streamdown's rehype plugins without `raw`, so raw HTML in an answer is not rendered. The
 * sanitizer and the link/image hardening still run.
 */
const { raw: _raw, ...SAFE_REHYPE_PLUGINS } = defaultRehypePlugins;

/** The answer's citations, read by the citation spans (keeps the markdown components stable). */
const CitationContext = createContext<{
  citations: ReadonlyMap<number, Citation>;
  onSelect: (citation: Citation) => void;
}>({ citations: new Map(), onSelect: () => {} });

/** Renders a citation span from {@link rehypeCitations} as chips; other spans stay spans. */
function MarkdownSpan({ node: _node, ...props }: ComponentProps<'span'> & { node?: unknown }) {
  const { citations, onSelect } = use(CitationContext);
  const markers = parseCitationAttribute((props as Record<string, unknown>)[CITATION_ATTRIBUTE]);
  if (markers.length === 0) return <span {...props} />;
  return (
    <span className="whitespace-nowrap">
      {markers.map((marker) => {
        const citation = citations.get(marker);
        return citation ? (
          <CitationChip key={marker} citation={citation} onSelect={onSelect} />
        ) : null;
      })}
    </span>
  );
}

/** Overrides of Streamdown's components: citation chips, and headings sized for a chat answer. */
const MARKDOWN_COMPONENTS: Components = {
  span: MarkdownSpan,
  h1: ({ children }) => (
    <h3 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => <h4 className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</h5>,
  h5: ({ children }) => <h6 className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</h6>,
  h6: ({ children }) => <h6 className="mt-3 mb-1.5 font-semibold first:mt-0">{children}</h6>,
};

/**
 * Answer text rendered as Markdown with Streamdown (memoized per block while streaming, see the AI
 * SDK "Markdown Chatbot with Memoization" recipe), with its `[n]` markers as citation chips.
 * Markers without a citation (invalid, or still streaming) are dropped; hovering a chip shows the
 * quote, clicking it opens the source viewer.
 */
export function CitationText({
  text,
  citations,
  onSelect,
  isAnimating = false,
}: {
  text: string;
  citations: ReadonlyMap<number, Citation>;
  onSelect: (citation: Citation) => void;
  /** True while the answer is still streaming in. */
  isAnimating?: boolean;
}) {
  const markerKey = [...citations.keys()].join(',');
  const rehypePlugins = useMemo<StreamdownProps['rehypePlugins']>(
    () => [
      ...Object.values(SAFE_REHYPE_PLUGINS),
      [rehypeCitations, new Set(markerKey ? markerKey.split(',').map(Number) : [])],
    ],
    [markerKey],
  );
  const context = useMemo(() => ({ citations, onSelect }), [citations, onSelect]);
  return (
    <CitationContext value={context}>
      <Streamdown
        className="text-sm leading-relaxed break-words"
        rehypePlugins={rehypePlugins}
        components={MARKDOWN_COMPONENTS}
        disallowedElements={DISALLOWED_ELEMENTS}
        isAnimating={isAnimating}
      >
        {text}
      </Streamdown>
    </CitationContext>
  );
}

function CitationChip({
  citation,
  onSelect,
}: {
  citation: Citation;
  onSelect: (citation: Citation) => void;
}) {
  const location = citation.page !== null ? `, p. ${citation.page}` : '';
  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <button
            type="button"
            onClick={() => onSelect(citation)}
            aria-label={`Citation ${citation.marker}: ${citation.sourceTitle}${location}`}
            className="mx-0.5 inline-flex h-4.5 min-w-4.5 translate-y-[-0.1em] items-center justify-center rounded-full bg-primary/10 px-1 align-baseline text-[0.7rem] font-medium text-primary tabular-nums hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        }
      >
        {citation.marker}
      </HoverCardTrigger>
      <HoverCardContent className="w-80" side="top">
        <p className="mb-1 truncate text-xs font-medium">
          {citation.sourceTitle || 'Untitled source'}
          <span className="text-muted-foreground">{location}</span>
        </p>
        <blockquote className="line-clamp-6 border-l-2 pl-2 text-xs whitespace-normal text-muted-foreground">
          {citation.quote}
        </blockquote>
      </HoverCardContent>
    </HoverCard>
  );
}
