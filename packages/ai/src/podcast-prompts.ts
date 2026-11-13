import {
  getLanguage,
  type LanguageCode,
  type PodcastLength,
  type PodcastMode,
  type PodcastSegment,
} from '@notebook-lite/shared';

/**
 * Prompts for podcast topic suggestions and scripts. The language is always passed in
 * explicitly (the notebook language for suggestions, the podcast's language snapshot for
 * scripts) and never inferred from the sources.
 */

/** A passage from a source, given to the model as grounding material. */
export interface PodcastExcerpt {
  sourceTitle: string;
  content: string;
}

function languageLabel(language: LanguageCode): string {
  const info = getLanguage(language);
  return `${info.englishName} (${info.name})`;
}

/** Renders excerpts as delimited blocks. Titles are attributes so they cannot break the format. */
export function formatPodcastExcerpts(excerpts: readonly PodcastExcerpt[]): string {
  return excerpts
    .map((excerpt, index) => {
      const title = excerpt.sourceTitle.replaceAll('"', "'").replaceAll(/\s+/g, ' ');
      return `<excerpt n="${index + 1}" source="${title}">\n${excerpt.content.trim()}\n</excerpt>`;
    })
    .join('\n\n');
}

// --- topic suggestions --------------------------------------------------------

export function topicSuggestionsSystemPrompt(language: LanguageCode): string {
  return [
    'You suggest topics for a short audio podcast that is based only on the excerpts the user provides.',
    'Return exactly 3 distinct topics. Each has a short, catchy title (at most 10 words) and an',
    'angle: one or two sentences on what the episode covers and why it is interesting.',
    'Every topic must be fully answerable from the excerpts. Do not use outside knowledge.',
    'Cover different aspects of the material, not three variations of the same idea.',
    `Write titles and angles in ${languageLabel(language)}, whatever language the excerpts are in.`,
    'Plain text only: no markdown, no quotes around titles, no numbering.',
  ].join('\n');
}

export function topicSuggestionsUserPrompt(excerpts: readonly PodcastExcerpt[]): string {
  return `Excerpts from the selected sources:\n\n${formatPodcastExcerpts(excerpts)}`;
}

// --- scripts ------------------------------------------------------------------

export interface ScriptBrief {
  language: LanguageCode;
  mode: PodcastMode;
  targetMinutes: PodcastLength;
  topic: string;
}

function formatRules(mode: PodcastMode): string {
  return mode === 'dialogue'
    ? [
        'Format: a conversation between two hosts. Speaker A leads and asks questions, speaker B',
        'explains and adds detail; both react naturally to each other. Alternate speakers often and',
        'keep most turns short (one to four sentences). Use "A" and "B" as speaker values.',
      ].join('\n')
    : 'Format: a monologue by a single host. Every segment uses speaker "A". Split the text into segments of one paragraph each.';
}

export function scriptSystemPrompt(brief: ScriptBrief): string {
  return [
    'You write scripts for an audio podcast that will be read aloud by a text-to-speech engine.',
    'Rules:',
    '- Use only facts from the excerpts the user provides. Never add outside knowledge, and do not',
    '  invent numbers, names, quotes or events. If the excerpts say little about part of the topic,',
    '  say so briefly instead of filling the gap.',
    `- Write everything in ${languageLabel(brief.language)}, whatever language the excerpts are in.`,
    '- Conversational spoken language: natural sentences, no lists, no headings.',
    '- Plain text only: no markdown, no emojis, no stage directions, no sound effects, no speaker',
    '  names inside the text, no URLs.',
    '- Never read citations or excerpt numbers aloud (no "[1]", no "excerpt 3").',
    '- Spell out abbreviations and symbols the way a speaker would say them.',
    formatRules(brief.mode),
  ].join('\n');
}

export function scriptUserPrompt(
  brief: ScriptBrief,
  targetWords: number,
  excerpts: readonly PodcastExcerpt[],
): string {
  return [
    `Topic: ${brief.topic}`,
    `Length: about ${brief.targetMinutes} minutes, so about ${targetWords} words in total (stay within 10 percent).`,
    'Open with a short hook that introduces the topic, and close with a brief wrap-up.',
    'Also give the episode a short title (at most 10 words).',
    '',
    `Excerpts:\n\n${formatPodcastExcerpts(excerpts)}`,
  ].join('\n');
}

export function outlineUserPrompt(
  brief: ScriptBrief,
  targetWords: number,
  sectionCount: number,
  excerpts: readonly PodcastExcerpt[],
): string {
  return [
    `Topic: ${brief.topic}`,
    `Plan an episode of about ${brief.targetMinutes} minutes (about ${targetWords} words).`,
    `Return a short episode title and an outline of exactly ${sectionCount} sections in speaking`,
    'order. The first section opens the episode with a hook, the last one wraps it up. For each',
    'section give a heading and the key points from the excerpts it covers. Do not repeat points',
    'across sections. Do not write the script yet.',
    '',
    `Excerpts:\n\n${formatPodcastExcerpts(excerpts)}`,
  ].join('\n');
}

export interface OutlineSection {
  heading: string;
  points: string[];
}

export function sectionUserPrompt(input: {
  brief: ScriptBrief;
  title: string;
  outline: readonly OutlineSection[];
  index: number;
  targetWords: number;
  previous: readonly PodcastSegment[];
  excerpts: readonly PodcastExcerpt[];
}): string {
  const { brief, outline, index } = input;
  const section = outline[index];
  if (!section) throw new Error(`outline has no section ${index}`);
  const position =
    index === 0
      ? 'This is the first section: open the episode with a short hook and introduce the topic.'
      : index === outline.length - 1
        ? 'This is the last section: continue seamlessly and close the episode with a brief wrap-up.'
        : 'This is a middle section: continue seamlessly, without greeting or wrapping up.';
  const previous = input.previous.length
    ? input.previous.map((segment) => `${segment.speaker}: ${segment.text}`).join('\n')
    : '(none, the episode starts here)';
  return [
    `Episode title: ${input.title}`,
    `Topic: ${brief.topic}`,
    'Outline:',
    ...outline.map(
      (item, i) => `${i + 1}. ${item.heading}${i === index ? '  <- write this section' : ''}`,
    ),
    '',
    `Write section ${index + 1} ("${section.heading}") with about ${input.targetWords} words.`,
    `Cover these points: ${section.points.join('; ')}`,
    position,
    '',
    `End of the previous section:\n${previous}`,
    '',
    `Excerpts:\n\n${formatPodcastExcerpts(input.excerpts)}`,
  ].join('\n');
}
