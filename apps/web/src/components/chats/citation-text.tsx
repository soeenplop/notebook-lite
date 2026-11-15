'use client';

import { type Citation, splitCitations } from '@notebook-lite/shared';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';

/**
 * Answer text with its `[n]` markers rendered as citation chips. Markers without a citation
 * (invalid, or still streaming) are dropped; hovering a chip shows the quote, clicking it opens
 * the source viewer.
 */
export function CitationText({
  text,
  citations,
  onSelect,
}: {
  text: string;
  citations: ReadonlyMap<number, Citation>;
  onSelect: (citation: Citation) => void;
}) {
  const valid = new Set(citations.keys());
  const segments = splitCitations(text, valid);
  return (
    <div className="text-sm leading-relaxed whitespace-pre-wrap">
      {segments.map((segment, index) =>
        segment.type === 'text' ? (
          // oxlint-disable-next-line react/no-array-index-key -- segments have no stable id
          <span key={index}>{segment.text}</span>
        ) : (
          // oxlint-disable-next-line react/no-array-index-key -- segments have no stable id
          <span key={index} className="whitespace-nowrap">
            {segment.markers.map((marker) => {
              const citation = citations.get(marker);
              return citation ? (
                <CitationChip key={marker} citation={citation} onSelect={onSelect} />
              ) : null;
            })}
          </span>
        ),
      )}
    </div>
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
