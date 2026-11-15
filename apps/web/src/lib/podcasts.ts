import {
  isActivePodcastStatus,
  type PodcastLength,
  type PodcastMode,
  type PodcastStatus,
} from '@notebook-lite/shared';

/** How often the podcast list and detail poll while a podcast is in production. */
export const PODCAST_POLL_MS = 4000;

export const PODCAST_STATUS_LABELS: Record<PodcastStatus, string> = {
  queued: 'Queued',
  scripting: 'Writing script',
  synthesizing: 'Recording audio',
  ready: 'Ready',
  failed: 'Failed',
};

export const PODCAST_MODE_OPTIONS: { value: PodcastMode; label: string; description: string }[] = [
  { value: 'dialogue', label: 'Dialogue', description: 'Two hosts discuss the topic' },
  { value: 'monologue', label: 'Monologue', description: 'One host explains the topic' },
];

export const PODCAST_LENGTH_OPTIONS: { value: PodcastLength; label: string }[] = [
  { value: 2, label: '~2 min' },
  { value: 6, label: '~6 min' },
  { value: 15, label: '~15 min' },
];

/** Poll interval for a list or detail query: only while something is in production. */
export function pollInterval(statuses: readonly PodcastStatus[] | undefined): number | false {
  return statuses?.some(isActivePodcastStatus) ? PODCAST_POLL_MS : false;
}

/** "0:42", "6:05", "1:02:03". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function modeLabel(mode: PodcastMode): string {
  return mode === 'dialogue' ? 'Dialogue' : 'Monologue';
}

/** Speaker names in the transcript. */
export function speakerLabel(speaker: 'A' | 'B', mode: PodcastMode): string {
  if (mode === 'monologue') return 'Host';
  return speaker === 'A' ? 'Host A' : 'Host B';
}

export type WizardStep = 'sources' | 'format' | 'topic';
export const WIZARD_STEPS: WizardStep[] = ['sources', 'format', 'topic'];

/** Whether the wizard may move on from `step` with the current selection. */
export function canContinue(
  step: WizardStep,
  state: { sourceIds: readonly string[]; topic: string },
): boolean {
  if (step === 'sources') return state.sourceIds.length > 0;
  if (step === 'topic') return state.topic.trim().length > 0;
  return true;
}
