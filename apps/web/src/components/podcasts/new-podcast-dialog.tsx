'use client';

import {
  PODCAST_TOPIC_MAX_LENGTH,
  PODCAST_TOPIC_SUGGESTION_COUNT,
  type PodcastLength,
  type PodcastMode,
  type PodcastTopicSuggestion,
  type SuggestPodcastTopicsInput,
} from '@notebook-lite/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SparklesIcon } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  canContinue,
  PODCAST_LENGTH_OPTIONS,
  PODCAST_MODE_OPTIONS,
  WIZARD_STEPS,
  type WizardStep,
} from '@/lib/podcasts';
import { useTRPC, useTRPCClient } from '@/lib/trpc/react';

interface NewPodcastDialogProps {
  notebookId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** "New podcast" wizard: sources → format (mode, length) → topic or one of 3 suggestions. */
export function NewPodcastDialog({ notebookId, open, onOpenChange }: NewPodcastDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {/* Mounted only while open, so every opening starts fresh. */}
        {open && <Wizard notebookId={notebookId} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

const STEP_TITLES: Record<WizardStep, string> = {
  sources: 'Choose sources',
  format: 'Choose a format',
  topic: 'Pick a topic',
};

function Wizard({ notebookId, onDone }: { notebookId: string; onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<WizardStep>('sources');
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [mode, setMode] = useState<PodcastMode>('dialogue');
  const [targetMinutes, setTargetMinutes] = useState<PodcastLength>(6);
  const [topic, setTopic] = useState('');

  const stepIndex = WIZARD_STEPS.indexOf(step);
  const create = useMutation(
    trpc.podcasts.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.podcasts.list.queryFilter({ notebookId }));
        await queryClient.invalidateQueries(trpc.notebooks.get.queryFilter({ id: notebookId }));
        toast.success('Podcast queued. This takes a few minutes.');
        onDone();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const ready = canContinue(step, { sourceIds, topic });
  const next = () => {
    const following = WIZARD_STEPS[stepIndex + 1];
    if (following) setStep(following);
    else create.mutate({ notebookId, sourceIds, mode, targetMinutes, topic });
  };

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !create.isPending) next();
      }}
    >
      <DialogHeader>
        <DialogTitle>New podcast</DialogTitle>
        <DialogDescription>
          Step {stepIndex + 1} of {WIZARD_STEPS.length}: {STEP_TITLES[step]}
        </DialogDescription>
      </DialogHeader>

      {step === 'sources' && (
        <SourcesStep notebookId={notebookId} selected={sourceIds} onChange={setSourceIds} />
      )}
      {step === 'format' && (
        <FormatStep
          mode={mode}
          onModeChange={setMode}
          targetMinutes={targetMinutes}
          onLengthChange={setTargetMinutes}
        />
      )}
      {step === 'topic' && (
        <TopicStep
          notebookId={notebookId}
          sourceIds={sourceIds}
          topic={topic}
          onTopicChange={setTopic}
        />
      )}

      <DialogFooter>
        {stepIndex > 0 ? (
          <Button
            type="button"
            variant="outline"
            disabled={create.isPending}
            onClick={() => setStep(WIZARD_STEPS[stepIndex - 1] ?? 'sources')}
          >
            Back
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!ready || create.isPending}>
          {step === 'topic' ? (create.isPending ? 'Creating…' : 'Create podcast') : 'Next'}
        </Button>
      </DialogFooter>
    </form>
  );
}

function SourcesStep({
  notebookId,
  selected,
  onChange,
}: {
  notebookId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const trpc = useTRPC();
  const sources = useQuery(trpc.podcasts.sourceOptions.queryOptions({ notebookId }));

  if (sources.isPending) {
    return (
      <div className="grid gap-2" aria-busy="true">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-2/3" />
      </div>
    );
  }
  if (sources.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load sources: {sources.error.message}
      </p>
    );
  }
  if (sources.data.length === 0) {
    return (
      <div className="grid gap-2 rounded-lg border border-dashed p-6 text-center text-sm">
        <p className="font-medium">No sources ready yet</p>
        <p className="text-muted-foreground">
          Add sources to this notebook and wait until they are processed, then create a podcast.
        </p>
        <div>
          <Button variant="outline" size="sm" render={<Link href={`/notebooks/${notebookId}`} />}>
            Go to the notebook
          </Button>
        </div>
      </div>
    );
  }

  const allIds = sources.data.map((source) => source.id);
  const allSelected = selected.length === allIds.length;
  const toggle = (id: string, checked: boolean) =>
    onChange(checked ? [...selected, id] : selected.filter((current) => current !== id));

  return (
    <fieldset className="grid gap-3">
      <legend className="sr-only">Sources</legend>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {selected.length} of {allIds.length} selected
        </span>
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => onChange(allSelected ? [] : allIds)}
        >
          {allSelected ? 'Clear' : 'Select all'}
        </Button>
      </div>
      <ul className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto rounded-lg border p-2">
        {sources.data.map((source) => (
          <li key={source.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={selected.includes(source.id)}
                onChange={(event) => toggle(source.id, event.target.checked)}
              />
              <span className="min-w-0 flex-1 truncate">{source.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground uppercase">
                {source.kind}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function FormatStep({
  mode,
  onModeChange,
  targetMinutes,
  onLengthChange,
}: {
  mode: PodcastMode;
  onModeChange: (mode: PodcastMode) => void;
  targetMinutes: PodcastLength;
  onLengthChange: (minutes: PodcastLength) => void;
}) {
  return (
    <div className="grid gap-5">
      <ChoiceGroup label="Format">
        {PODCAST_MODE_OPTIONS.map((option) => (
          <Choice
            key={option.value}
            name="mode"
            selected={mode === option.value}
            onSelect={() => onModeChange(option.value)}
          >
            <span className="font-medium">{option.label}</span>
            <span className="text-xs text-muted-foreground">{option.description}</span>
          </Choice>
        ))}
      </ChoiceGroup>
      <ChoiceGroup label="Length">
        {PODCAST_LENGTH_OPTIONS.map((option) => (
          <Choice
            key={option.value}
            name="length"
            selected={targetMinutes === option.value}
            onSelect={() => onLengthChange(option.value)}
          >
            <span className="font-medium">{option.label}</span>
          </Choice>
        ))}
      </ChoiceGroup>
    </div>
  );
}

function ChoiceGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </fieldset>
  );
}

function Choice({
  name,
  selected,
  onSelect,
  children,
}: {
  name: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label className="grid cursor-pointer gap-0.5 rounded-lg border p-3 text-sm transition-colors hover:bg-muted has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50">
      <input type="radio" name={name} className="sr-only" checked={selected} onChange={onSelect} />
      {children}
    </label>
  );
}

/**
 * Topic suggestions streamed from the API: each topic shows up as soon as the model has
 * finished it. A new request (or unmounting) aborts the previous one, which also stops the
 * LLM call on the server.
 */
function useTopicSuggestions() {
  const client = useTRPCClient();
  const [topics, setTopics] = useState<PodcastTopicSuggestion[]>([]);
  const [isPending, setIsPending] = useState(false);
  const current = useRef<AbortController | null>(null);

  useEffect(() => () => current.current?.abort(), []);

  const suggest = async (input: SuggestPodcastTopicsInput) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setTopics([]);
    setIsPending(true);
    try {
      const stream = await client.podcasts.suggestTopics.mutate(input, {
        signal: controller.signal,
      });
      for await (const topic of stream) {
        if (controller.signal.aborted) return;
        setTopics((previous) => [...previous, topic]);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      toast.error(error instanceof Error ? error.message : 'Could not suggest topics.');
    } finally {
      if (current.current === controller) {
        current.current = null;
        setIsPending(false);
      }
    }
  };

  return { topics, isPending, suggest };
}

function TopicStep({
  notebookId,
  sourceIds,
  topic,
  onTopicChange,
}: {
  notebookId: string;
  sourceIds: string[];
  topic: string;
  onTopicChange: (topic: string) => void;
}) {
  const topicId = useId();
  const suggestions = useTopicSuggestions();
  const choose = (suggestion: PodcastTopicSuggestion) =>
    onTopicChange(`${suggestion.title}: ${suggestion.angle}`.slice(0, PODCAST_TOPIC_MAX_LENGTH));

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={topicId}>Topic</Label>
        <Textarea
          id={topicId}
          value={topic}
          maxLength={PODCAST_TOPIC_MAX_LENGTH}
          rows={3}
          placeholder="What should the episode be about?"
          onChange={(event) => onTopicChange(event.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">
            No idea? Let the sources inspire you.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={suggestions.isPending}
            onClick={() => void suggestions.suggest({ notebookId, sourceIds })}
          >
            <SparklesIcon aria-hidden />
            {suggestions.isPending
              ? 'Suggesting…'
              : suggestions.topics.length > 0
                ? 'Suggest again'
                : 'Suggest topics'}
          </Button>
        </div>
        {(suggestions.isPending || suggestions.topics.length > 0) && (
          <ul className="grid gap-2" aria-busy={suggestions.isPending}>
            {suggestions.topics.map((suggestion) => (
              <li key={suggestion.title}>
                <button
                  type="button"
                  onClick={() => choose(suggestion)}
                  className="grid w-full gap-0.5 rounded-lg border p-3 text-left text-sm break-words transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="font-medium">{suggestion.title}</span>
                  <span className="text-muted-foreground">{suggestion.angle}</span>
                </button>
              </li>
            ))}
            {suggestions.isPending &&
              Array.from(
                { length: Math.max(0, PODCAST_TOPIC_SUGGESTION_COUNT - suggestions.topics.length) },
                (_, index) => (
                  <li key={`pending-${index}`}>
                    <Skeleton className="h-14 w-full" />
                  </li>
                ),
              )}
          </ul>
        )}
      </div>
    </div>
  );
}
