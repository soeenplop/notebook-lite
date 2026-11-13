'use client';

import type { ChatSourceOption } from '@notebook-lite/shared';
import { FileTextIcon, GlobeIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<ChatSourceOption['status'], string> = {
  pending: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

/**
 * Checkboxes over the notebook's sources. Only `ready` sources can be selected; others are shown
 * disabled with their status.
 */
export function SourceSelector({
  sources,
  selected,
  onChange,
  disabled,
}: {
  sources: readonly ChatSourceOption[];
  selected: ReadonlySet<string>;
  onChange: (selected: Set<string>) => void;
  disabled?: boolean;
}) {
  const ready = sources.filter((source) => source.status === 'ready');
  const selectedReady = ready.filter((source) => selected.has(source.id)).length;

  return (
    <section className="grid content-start gap-3 rounded-xl border p-4" aria-label="Sources">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <FileTextIcon className="size-4 text-muted-foreground" />
          Sources
        </h2>
        {ready.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {selectedReady} of {ready.length} selected
          </span>
        )}
      </div>

      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This notebook has no sources yet. Add sources to the notebook to chat with them.
        </p>
      ) : (
        <>
          <ul className="grid gap-1">
            {sources.map((source) => {
              const isReady = source.status === 'ready';
              const Icon = source.kind === 'url' ? GlobeIcon : FileTextIcon;
              return (
                <li key={source.id}>
                  <label
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-1 py-1 text-sm',
                      isReady && !disabled ? 'cursor-pointer hover:bg-muted' : 'opacity-60',
                    )}
                  >
                    <Checkbox
                      checked={isReady && selected.has(source.id)}
                      disabled={!isReady || disabled}
                      onCheckedChange={(checked) => {
                        const next = new Set(selected);
                        if (checked) next.add(source.id);
                        else next.delete(source.id);
                        onChange(next);
                      }}
                    />
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate" title={source.title}>
                      {source.title}
                    </span>
                    {!isReady && (
                      <Badge
                        variant={source.status === 'failed' ? 'destructive' : 'secondary'}
                        className="shrink-0"
                      >
                        {STATUS_LABEL[source.status]}
                      </Badge>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
          {ready.length > 1 && (
            <div className="flex gap-1">
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled || selectedReady === ready.length}
                onClick={() => onChange(new Set(ready.map((source) => source.id)))}
              >
                Select all
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled || selectedReady === 0}
                onClick={() => onChange(new Set())}
              >
                Clear
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
