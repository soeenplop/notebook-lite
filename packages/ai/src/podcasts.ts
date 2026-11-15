import {
  type LanguageCode,
  PODCAST_TITLE_MAX_LENGTH,
  type PodcastScript,
  type PodcastSegment,
  type PodcastTopicSuggestion,
  podcastScriptSchema,
  podcastTopicSuggestionsSchema,
  podcastWordTarget,
} from '@notebook-lite/shared';
import { generateText, type LanguageModel, Output } from 'ai';
import { z } from 'zod';
import {
  type OutlineSection,
  outlineUserPrompt,
  type PodcastExcerpt,
  type ScriptBrief,
  scriptSystemPrompt,
  scriptUserPrompt,
  sectionUserPrompt,
  topicSuggestionsSystemPrompt,
  topicSuggestionsUserPrompt,
} from './podcast-prompts.js';

export type { PodcastExcerpt, ScriptBrief } from './podcast-prompts.js';

interface CallOptions {
  abortSignal?: AbortSignal;
  maxRetries?: number;
}

function callSettings(options: CallOptions) {
  return {
    maxRetries: options.maxRetries ?? 2,
    ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
  };
}

// --- topic suggestions --------------------------------------------------------

/** Suggests exactly three podcast topics from source excerpts, in the notebook language. */
export async function suggestPodcastTopics(
  model: LanguageModel,
  input: { language: LanguageCode; excerpts: readonly PodcastExcerpt[] } & CallOptions,
): Promise<PodcastTopicSuggestion[]> {
  if (input.excerpts.length === 0) throw new Error('no excerpts to suggest topics from');
  const { output } = await generateText({
    model,
    system: topicSuggestionsSystemPrompt(input.language),
    prompt: topicSuggestionsUserPrompt(input.excerpts),
    output: Output.object({ schema: podcastTopicSuggestionsSchema }),
    ...callSettings(input),
  });
  return output.topics.map((topic) => ({
    title: cleanSpokenText(topic.title),
    angle: cleanSpokenText(topic.angle),
  }));
}

// --- scripts ------------------------------------------------------------------

/** Lengths at or above this many minutes are written section by section from an outline. */
export const OUTLINE_MIN_MINUTES = 15;
/** Sections of an outlined script (about 375–450 words each for 15 minutes). */
export const OUTLINE_SECTION_COUNT = 5;
/** Segments of the previous section shown to the model for continuity. */
const CONTEXT_SEGMENTS = 4;

const segmentsSchema = z.object({
  segments: z.array(z.object({ speaker: z.enum(['A', 'B']), text: z.string().min(1) })).min(1),
});

const scriptOutputSchema = segmentsSchema.extend({ title: z.string().min(1) });

const outlineSchema = z.object({
  title: z.string().min(1),
  sections: z
    .array(z.object({ heading: z.string().min(1), points: z.array(z.string().min(1)).min(1) }))
    .min(2),
});

export interface GenerateScriptInput extends ScriptBrief, CallOptions {
  excerpts: readonly PodcastExcerpt[];
}

/**
 * Writes a podcast script grounded in the excerpts, in `language`. Short episodes are written
 * in one call; long ones (15 min) get an outline first and are then written section by
 * section, which keeps every call well within the model's output limit.
 */
export async function generatePodcastScript(
  model: LanguageModel,
  input: GenerateScriptInput,
): Promise<PodcastScript> {
  if (input.excerpts.length === 0) throw new Error('no excerpts to write a script from');
  const targetWords = podcastWordTarget(input.language, input.targetMinutes);
  const draft =
    input.targetMinutes >= OUTLINE_MIN_MINUTES
      ? await generateOutlinedScript(model, input, targetWords)
      : await generateSingleScript(model, input, targetWords);
  return finalizeScript(draft, input);
}

async function generateSingleScript(
  model: LanguageModel,
  input: GenerateScriptInput,
  targetWords: number,
): Promise<{ title: string; segments: PodcastSegment[] }> {
  const { output } = await generateText({
    model,
    system: scriptSystemPrompt(input),
    prompt: scriptUserPrompt(input, targetWords, input.excerpts),
    output: Output.object({ schema: scriptOutputSchema }),
    ...callSettings(input),
  });
  return output;
}

async function generateOutlinedScript(
  model: LanguageModel,
  input: GenerateScriptInput,
  targetWords: number,
): Promise<{ title: string; segments: PodcastSegment[] }> {
  const system = scriptSystemPrompt(input);
  const { output: outline } = await generateText({
    model,
    system,
    prompt: outlineUserPrompt(input, targetWords, OUTLINE_SECTION_COUNT, input.excerpts),
    output: Output.object({ schema: outlineSchema }),
    ...callSettings(input),
  });

  const sections: OutlineSection[] = outline.sections;
  const sectionWords = Math.round(targetWords / sections.length);
  const segments: PodcastSegment[] = [];
  for (let index = 0; index < sections.length; index++) {
    // Sequential on purpose: each section continues from the end of the previous one.
    // oxlint-disable-next-line no-await-in-loop
    const { output } = await generateText({
      model,
      system,
      prompt: sectionUserPrompt({
        brief: input,
        title: outline.title,
        outline: sections,
        index,
        targetWords: sectionWords,
        previous: segments.slice(-CONTEXT_SEGMENTS),
        excerpts: input.excerpts,
      }),
      output: Output.object({ schema: segmentsSchema }),
      ...callSettings(input),
    });
    segments.push(...output.segments);
  }
  return { title: outline.title, segments };
}

/** Cleans the model output into a valid script: plain spoken text, monologue → speaker A. */
function finalizeScript(
  draft: { title: string; segments: PodcastSegment[] },
  brief: ScriptBrief,
): PodcastScript {
  const segments: PodcastSegment[] = [];
  for (const segment of draft.segments) {
    const text = cleanSpokenText(segment.text);
    if (!text) continue;
    const speaker = brief.mode === 'monologue' ? 'A' : segment.speaker;
    const last = segments.at(-1);
    // Adjacent turns of the same speaker read better as one segment.
    if (last && last.speaker === speaker) last.text = `${last.text} ${text}`;
    else segments.push({ speaker, text });
  }
  const title =
    cleanSpokenText(draft.title).slice(0, PODCAST_TITLE_MAX_LENGTH).trim() ||
    brief.topic.slice(0, PODCAST_TITLE_MAX_LENGTH);
  return podcastScriptSchema.parse({ title, segments });
}

/**
 * Removes what a TTS engine should not read: citation markers, markdown emphasis and
 * headings, code ticks, and speaker labels the model may have put into the text.
 */
export function cleanSpokenText(text: string): string {
  return text
    .replaceAll(/\[\d+(?:\s*[,–-]\s*\d+)*\]/g, '')
    .replaceAll(/^\s*#{1,6}\s+/gm, '')
    .replaceAll(/^\s*(?:[-*•]|\d+\.)\s+/gm, '')
    .replaceAll(/\*\*|__|`/g, '')
    .replaceAll(/(^|\s)\*(\S[^*]*\S|\S)\*(?=\s|[.,;:!?]|$)/g, '$1$2')
    .replace(/^\s*(?:Speaker\s+)?[AB]\s*:\s*/i, '')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/** Number of words in a script (for logging and checks against the target). */
export function countScriptWords(script: Pick<PodcastScript, 'segments'>): number {
  return script.segments.reduce(
    (sum, segment) => sum + segment.text.split(/\s+/).filter(Boolean).length,
    0,
  );
}
