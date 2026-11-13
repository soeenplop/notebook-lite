import type { PodcastSegment, PodcastSpeaker } from '@notebook-lite/shared';
import { DIALOGUE_MAX_CHARS, type DialogueInput } from './elevenlabs.client.js';

export type VoiceMap = Record<PodcastSpeaker, string | undefined>;

/**
 * Splits a script into text-to-dialogue requests of at most `maxChars` characters in total.
 * Batches break at segment boundaries; a segment longer than the limit is split at sentence
 * boundaries (or, for a single overlong sentence, at word boundaries). The result is
 * deterministic for a given script, so cached batch audio stays valid across job retries.
 */
export function buildDialogueBatches(
  segments: readonly PodcastSegment[],
  voices: VoiceMap,
  maxChars: number = DIALOGUE_MAX_CHARS,
): DialogueInput[][] {
  const batches: DialogueInput[][] = [];
  let batch: DialogueInput[] = [];
  let size = 0;

  for (const segment of segments) {
    const voice = voices[segment.speaker];
    if (!voice) throw new Error(`no voice configured for speaker ${segment.speaker}`);
    for (const text of splitText(segment.text.trim(), maxChars)) {
      if (batch.length > 0 && size + text.length > maxChars) {
        batches.push(batch);
        batch = [];
        size = 0;
      }
      batch.push({ text, voice_id: voice });
      size += text.length;
    }
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** Splits text into pieces of at most `maxChars`, preferring sentence, then word boundaries. */
export function splitText(text: string, maxChars: number): string[] {
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  let current = '';
  const push = () => {
    if (current) pieces.push(current);
    current = '';
  };
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    const units = sentence.length <= maxChars ? [sentence] : splitWords(sentence, maxChars);
    for (const unit of units) {
      const next = current ? `${current} ${unit}` : unit;
      if (next.length <= maxChars) {
        current = next;
      } else {
        push();
        current = unit;
      }
    }
  }
  push();
  return pieces;
}

function splitWords(sentence: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const word of sentence.split(/\s+/)) {
    // A single "word" longer than the limit (unlikely in a script) is cut hard.
    for (let start = 0; start < word.length; start += maxChars) {
      const part = word.slice(start, start + maxChars);
      const next = current ? `${current} ${part}` : part;
      if (next.length <= maxChars) {
        current = next;
      } else {
        pieces.push(current);
        current = part;
      }
    }
  }
  if (current) pieces.push(current);
  return pieces;
}
