import {
  getLanguage,
  type LanguageCode,
  PODCAST_AUDIO_TAGS,
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

/** Everyday spoken fillers per language, so the hosts sound like people, not like an essay. */
const FILLER_EXAMPLES: Record<LanguageCode, string> = {
  de: '"ähm", "also", "na ja", "weißt du", "ich meine"',
  en: '"um", "well", "you know", "I mean", "right"',
};

function formatRules(mode: PodcastMode): string {
  return mode === 'dialogue'
    ? [
        'Format: a lively conversation between two hosts with distinct personalities. Use "A" and',
        '"B" as speaker values.',
        '- Host A is curious and a little skeptical. A speaks for the listener: asks the obvious and',
        '  the not so obvious questions, pushes back when something sounds too good, compares new',
        '  ideas with everyday life and sums up what was just said in plain words.',
        '- Host B knows the material and is enthusiastic about it, sometimes getting lost in',
        '  details until A pulls the conversation back.',
        '- They talk with each other, not at the listener: follow-up questions ("Wait, so that',
        '  means ...?"), short reactions ("Really?", "Exactly."), friendly disagreement, a',
        "  misunderstanding that B clears up, finishing each other's thoughts.",
        '- Alternate speakers often. Most turns are short (one to three sentences); only B gets',
        '  an occasional longer explanation.',
      ].join('\n')
    : [
        'Format: a monologue by a single host who talks to the listener like a friend: asks',
        'questions and answers them, sounds genuinely interested and occasionally surprised by the',
        'material. Every segment uses speaker "A". Split the text into segments of one paragraph each.',
      ].join('\n');
}

export function scriptSystemPrompt(brief: ScriptBrief): string {
  return [
    'You write scripts for an audio podcast that will be read aloud by a text-to-speech engine.',
    'The episode should be as engaging as a good podcast: curiosity, surprise, tension, and a',
    'reason to keep listening, without ever leaving the facts of the excerpts.',
    'Rules:',
    '- Use only facts from the excerpts the user provides. Never add outside knowledge, and do not',
    '  invent numbers, names, quotes or events. If the excerpts say little about part of the topic,',
    '  say so briefly instead of filling the gap. Everyday analogies that explain a fact are',
    '  welcome, as long as they add no new facts.',
    '- Where the excerpts disagree, contradict each other or contain something counterintuitive,',
    '  make that a highlight of the episode instead of smoothing it over.',
    `- Write everything in ${languageLabel(brief.language)}, whatever language the excerpts are in.`,
    '- Conversational spoken language: natural sentences, no lists, no headings. Now and then a',
    `  filler such as ${FILLER_EXAMPLES[brief.language]}, a restarted sentence or a short pause`,
    '  ("...") makes it sound natural. Use them sparingly, at most one every few turns.',
    `- Audio tags: you may put one of these tags in square brackets before a sentence to shape the`,
    `  delivery: ${PODCAST_AUDIO_TAGS.map((tag) => `[${tag}]`).join(', ')}. Tags stay in English`,
    '  whatever the script language. Use them sparingly and only where the emotion fits, at most',
    '  one per turn and not in every turn. No other tags or bracketed text.',
    '- Plain text only: no markdown, no emojis, no other stage directions, no sound effects, no',
    '  speaker names inside the text, no URLs.',
    '- Never read citations or excerpt numbers aloud (no "[1]", no "excerpt 3").',
    '- Spell out abbreviations and symbols the way a speaker would say them.',
    formatRules(brief.mode),
  ].join('\n');
}

/**
 * How the episode opens and closes. Like a real podcast: a cold open, a short welcome and a
 * preview at the start; takeaways and a brief farewell at the end. Hosts stay nameless and the
 * show has no name, so the model must not invent either.
 */
function introInstruction(mode: PodcastMode): string {
  const welcome =
    mode === 'dialogue'
      ? 'the hosts warmly welcome the listener and greet each other in a line or two'
      : 'the host warmly welcomes the listener';
  return [
    'Open like a real podcast episode, in three short beats:',
    '1. Cold open: one to three sentences with a hook taken from the excerpts (the most surprising',
    '   fact, a striking contradiction or a question the listener wants answered).',
    `2. Welcome: ${welcome}, in a relaxed, friendly tone.`,
    '3. Preview: one or two sentences on what this episode is about and why it is worth listening,',
    '   ideally teasing a point that comes later, without giving it away.',
    'Keep the whole opening to about 10 percent of the episode. Do not invent a show name or host',
    'names, and avoid stiff phrases like "Today we talk about ...".',
  ].join('\n');
}

function outroInstruction(mode: PodcastMode): string {
  const farewell =
    mode === 'dialogue'
      ? 'the hosts react to each other one last time, briefly thank each other, then thank the listener and say goodbye together'
      : 'the host thanks the listener for listening and says goodbye';
  return [
    'Close like a real podcast episode, in two short beats:',
    '1. Takeaways: one to three concrete takeaways or an open question to think about, not a',
    '   recap of everything that was said. A callback to the hook from the opening works well.',
    `2. Farewell: ${farewell}, warm and natural, in a few sentences.`,
    'Do not invent a show name or host names, do not ask listeners to subscribe or rate, and do',
    'not announce future episodes.',
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
    introInstruction(brief.mode),
    outroInstruction(brief.mode),
    'Also give the episode a short, catchy title (at most 10 words, no audio tags).',
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
    `Return a short, catchy episode title and an outline of exactly ${sectionCount} sections in`,
    'speaking order. Give the episode an arc: the first section opens like a podcast (a hook from',
    'the excerpts, a short welcome and a preview of the episode), the middle sections build up to',
    'the most interesting or contested point, the last one closes with concrete takeaways or an',
    'open question and a short farewell. For each section give a heading and the key points from the excerpts',
    'it covers. Do not repeat points across sections. Do not write the script yet.',
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
      ? `This is the first section.\n${introInstruction(brief.mode)}`
      : index === outline.length - 1
        ? `This is the last section: continue seamlessly, without a new welcome.\n${outroInstruction(brief.mode)}`
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
