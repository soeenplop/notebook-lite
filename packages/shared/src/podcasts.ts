import { z } from 'zod';
import { getLanguage, type LanguageCode, languageCodeSchema } from './languages.js';
import { notebookIdSchema } from './notebooks.js';

/** Limits and enums mirror the check constraints on public.podcasts. */
export const PODCAST_MODES = ['monologue', 'dialogue'] as const;
export const podcastModeSchema = z.enum(PODCAST_MODES);
export type PodcastMode = z.infer<typeof podcastModeSchema>;

export const PODCAST_LENGTHS = [2, 6, 15] as const;
export const podcastLengthSchema = z.union([z.literal(2), z.literal(6), z.literal(15)]);
export type PodcastLength = z.infer<typeof podcastLengthSchema>;

export const PODCAST_STATUSES = ['queued', 'scripting', 'synthesizing', 'ready', 'failed'] as const;
export const podcastStatusSchema = z.enum(PODCAST_STATUSES);
export type PodcastStatus = z.infer<typeof podcastStatusSchema>;

/** Statuses of a podcast that is still being produced. */
export const ACTIVE_PODCAST_STATUSES = [
  'queued',
  'scripting',
  'synthesizing',
] as const satisfies readonly PodcastStatus[];

export function isActivePodcastStatus(status: PodcastStatus): boolean {
  return (ACTIVE_PODCAST_STATUSES as readonly PodcastStatus[]).includes(status);
}

export const PODCAST_TOPIC_MAX_LENGTH = 500;
export const PODCAST_TITLE_MAX_LENGTH = 200;
/** Max sources per podcast or topic suggestion request. */
export const PODCAST_MAX_SOURCES = 50;

export const podcastIdSchema = z.uuid();

export const podcastTopicSchema = z
  .string()
  .trim()
  .min(1, 'Topic is required')
  .max(PODCAST_TOPIC_MAX_LENGTH, `Topic must be at most ${PODCAST_TOPIC_MAX_LENGTH} characters`);

const podcastSourceIdsSchema = z
  .array(z.uuid())
  .min(1, 'Select at least one source')
  .max(PODCAST_MAX_SOURCES, `Select at most ${PODCAST_MAX_SOURCES} sources`)
  .transform((ids) => [...new Set(ids)]);

// --- script -------------------------------------------------------------------

export const podcastSpeakerSchema = z.enum(['A', 'B']);
export type PodcastSpeaker = z.infer<typeof podcastSpeakerSchema>;

export const podcastSegmentSchema = z.object({
  speaker: podcastSpeakerSchema,
  text: z.string().min(1),
});
export type PodcastSegment = z.infer<typeof podcastSegmentSchema>;

/** The generated script, stored in `podcasts.script`. Monologues only use speaker A. */
export const podcastScriptSchema = z.object({
  title: z.string().min(1).max(PODCAST_TITLE_MAX_LENGTH),
  segments: z.array(podcastSegmentSchema).min(1),
});
export type PodcastScript = z.infer<typeof podcastScriptSchema>;

/**
 * Audio tags the script may contain (ElevenLabs v3/v4 read `[laughs]` etc. as delivery cues,
 * not as words). Scripts keep only these; everything else in square brackets is removed.
 */
export const PODCAST_AUDIO_TAGS = [
  'laughs',
  'chuckles',
  'sighs',
  'excited',
  'curious',
  'surprised',
  'thoughtful',
  'skeptical',
] as const;
export type PodcastAudioTag = (typeof PODCAST_AUDIO_TAGS)[number];

export function isPodcastAudioTag(value: string): value is PodcastAudioTag {
  return (PODCAST_AUDIO_TAGS as readonly string[]).includes(value);
}

/** Removes audio tags from script text, e.g. for the transcript or word counts. */
export function stripAudioTags(text: string): string {
  return text
    .replaceAll(/\[[a-z][a-z ]*\]/gi, '')
    .replaceAll(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Playback tempo applied to the finished episode (ffmpeg `atempo`, pitch-preserving). The
 * ElevenLabs text-to-dialogue endpoint has no speed setting, so the worker speeds the audio up
 * when it joins the batches. 1.1 = 10 % faster than the voices' natural pace.
 */
export const PODCAST_SPEECH_TEMPO = 1.1;

/**
 * Target word count of a script: the language's speaking rate, sped up by
 * {@link PODCAST_SPEECH_TEMPO}, times the length in minutes
 * (e.g. English 150 wpm × 1.1 × 6 min = 990 words).
 */
export function podcastWordTarget(language: LanguageCode, minutes: PodcastLength): number {
  return Math.round(getLanguage(language).wordsPerMinute * PODCAST_SPEECH_TEMPO * minutes);
}

// --- topic suggestions --------------------------------------------------------

export const podcastTopicSuggestionSchema = z.object({
  title: z.string().min(1).max(120),
  angle: z.string().min(1).max(400),
});
export type PodcastTopicSuggestion = z.infer<typeof podcastTopicSuggestionSchema>;

/** Topics suggested per request; they are streamed to the client one by one. */
export const PODCAST_TOPIC_SUGGESTION_COUNT = 3;

export const suggestPodcastTopicsInputSchema = z.object({
  notebookId: notebookIdSchema,
  sourceIds: podcastSourceIdsSchema,
});
export type SuggestPodcastTopicsInput = z.input<typeof suggestPodcastTopicsInputSchema>;

// --- procedures ---------------------------------------------------------------

export const createPodcastInputSchema = z.object({
  notebookId: notebookIdSchema,
  sourceIds: podcastSourceIdsSchema,
  mode: podcastModeSchema,
  targetMinutes: podcastLengthSchema,
  topic: podcastTopicSchema,
});
export type CreatePodcastInput = z.input<typeof createPodcastInputSchema>;

export const listPodcastsInputSchema = z.object({ notebookId: notebookIdSchema });
export const podcastByIdInputSchema = z.object({ id: podcastIdSchema });

/** Postgres NOTIFY channel a trigger on public.podcasts writes to on status or title changes. */
export const PODCAST_CHANGES_CHANNEL = 'podcast_changes';

/** Payload of a `PODCAST_CHANGES_CHANNEL` notification (built by `notify_podcast_change()`). */
export const podcastChangeNotificationSchema = z.object({
  userId: z.uuid(),
  notebookId: notebookIdSchema,
  podcastId: podcastIdSchema,
  status: podcastStatusSchema,
});
export type PodcastChangeNotification = z.infer<typeof podcastChangeNotificationSchema>;

/**
 * Event of the `podcasts.onChange` subscription. `changed`: a podcast's status or title changed.
 * `resync`: the server may have missed changes (its database listener reconnected), so clients
 * refetch whatever they show.
 */
export type PodcastChangeEvent =
  { type: 'changed'; podcastId: string; status: PodcastStatus } | { type: 'resync' };

/** A source the podcast wizard can offer (ready sources of the notebook). */
export const podcastSourceOptionSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  kind: z.string(),
});
export type PodcastSourceOption = z.infer<typeof podcastSourceOptionSchema>;

export const podcastSummarySchema = z.object({
  id: podcastIdSchema,
  notebookId: notebookIdSchema,
  title: z.string().nullable(),
  topic: z.string(),
  mode: podcastModeSchema,
  targetMinutes: podcastLengthSchema,
  language: languageCodeSchema,
  status: podcastStatusSchema,
  error: z.string().nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type PodcastSummary = z.infer<typeof podcastSummarySchema>;

export const podcastDetailSchema = podcastSummarySchema.extend({
  script: podcastScriptSchema.nullable(),
  sources: z.array(z.object({ id: z.uuid(), title: z.string() })),
  /** Short-lived signed URLs; null until the podcast is ready. */
  audioUrl: z.url().nullable(),
  downloadUrl: z.url().nullable(),
});
export type PodcastDetail = z.infer<typeof podcastDetailSchema>;

// --- storage ------------------------------------------------------------------

export const PODCASTS_BUCKET = 'podcasts';

/**
 * Storage folder of one podcast in the `podcasts` bucket. The first segment is the owner's id,
 * which the bucket's RLS policies check.
 */
export function podcastStorageFolder(
  userId: string,
  notebookId: string,
  podcastId: string,
): string {
  return `${userId}/${notebookId}/${podcastId}`;
}

/** The finished MP3. */
export function podcastAudioPath(userId: string, notebookId: string, podcastId: string): string {
  return `${podcastStorageFolder(userId, notebookId, podcastId)}/podcast.mp3`;
}

/** Cached audio of one TTS batch (n starts at 0), so a retried job resumes. */
export function podcastBatchPath(
  userId: string,
  notebookId: string,
  podcastId: string,
  n: number,
): string {
  return `${podcastStorageFolder(userId, notebookId, podcastId)}/batch-${n}.mp3`;
}
