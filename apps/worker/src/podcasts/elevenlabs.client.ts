/**
 * Minimal client for the ElevenLabs text-to-dialogue endpoint
 * (`POST /v1/text-to-dialogue`, https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert).
 * Used for both podcast modes: a monologue is a dialogue with one voice.
 *
 * Spike findings (2026-11-13, see docs/CORRECTIONS.md):
 *   - body `{ inputs: [{ text, voice_id }], model_id, language_code }`; `model_id` defaults to
 *     `eleven_v3`, `language_code` is ISO 639-1 and ignored by models that don't support it
 *   - `output_format` query parameter, default `mp3_44100_128`; the response body is the audio
 *   - at most 2,000 characters across all inputs per request for reliable output, at most
 *     10 distinct voices
 *   - auth via the `xi-api-key` header
 */

/** Documented per-request limit for the sum of all input texts. */
export const DIALOGUE_MAX_CHARS = 2000;
export const DIALOGUE_OUTPUT_FORMAT = 'mp3_44100_128';

export interface DialogueInput {
  text: string;
  voice_id: string;
}

export interface DialogueRequest {
  inputs: DialogueInput[];
  /** ISO 639-1 code, e.g. `de`. */
  languageCode: string;
  signal?: AbortSignal;
}

/** Turns a dialogue into MP3 audio. Tests and the pipeline depend on this, not the class. */
export interface DialogueSynthesizer {
  synthesize(request: DialogueRequest): Promise<Buffer>;
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ElevenLabsError';
  }
}

export interface ElevenLabsClientOptions {
  apiKey: string;
  modelId: string;
  baseUrl?: string;
  /** Retries after the first attempt for rate limits, server errors and network failures. */
  maxRetries?: number;
  /** First backoff delay; doubles per retry (with jitter). */
  baseDelayMs?: number;
  /** Per-request timeout (long batches take a while to render). */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class ElevenLabsClient implements DialogueSynthesizer {
  readonly #apiKey: string;
  readonly #modelId: string;
  readonly #baseUrl: string;
  readonly #maxRetries: number;
  readonly #baseDelayMs: number;
  readonly #timeoutMs: number;
  readonly #fetch: typeof globalThis.fetch;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #random: () => number;

  constructor(options: ElevenLabsClientOptions) {
    this.#apiKey = options.apiKey;
    this.#modelId = options.modelId;
    this.#baseUrl = (options.baseUrl ?? 'https://api.elevenlabs.io').replace(/\/+$/, '');
    this.#maxRetries = options.maxRetries ?? 4;
    this.#baseDelayMs = options.baseDelayMs ?? 2000;
    this.#timeoutMs = options.timeoutMs ?? 5 * 60_000;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#sleep = options.sleep ?? sleep;
    this.#random = options.random ?? Math.random;
  }

  async synthesize(request: DialogueRequest): Promise<Buffer> {
    const characters = request.inputs.reduce((sum, input) => sum + input.text.length, 0);
    if (request.inputs.length === 0 || characters === 0) {
      throw new ElevenLabsError('dialogue has no text', null, false);
    }
    if (characters > DIALOGUE_MAX_CHARS) {
      throw new ElevenLabsError(
        `dialogue has ${characters} characters, the limit is ${DIALOGUE_MAX_CHARS}`,
        null,
        false,
      );
    }

    for (let attempt = 0; ; attempt++) {
      try {
        // Sequential retries by design.
        // oxlint-disable-next-line no-await-in-loop
        return await this.#request(request);
      } catch (error) {
        const failure = toElevenLabsError(error);
        if (!failure.retryable || attempt >= this.#maxRetries || request.signal?.aborted) {
          throw failure;
        }
        const retryAfterMs = error instanceof RetryAfter ? error.ms : 0;
        const backoff = this.#baseDelayMs * 2 ** attempt * (0.75 + this.#random() * 0.5);
        // oxlint-disable-next-line no-await-in-loop
        await this.#sleep(Math.max(retryAfterMs, backoff), request.signal);
      }
    }
  }

  async #request(request: DialogueRequest): Promise<Buffer> {
    const url = `${this.#baseUrl}/v1/text-to-dialogue?output_format=${DIALOGUE_OUTPUT_FORMAT}`;
    const signals = [AbortSignal.timeout(this.#timeoutMs)];
    if (request.signal) signals.push(request.signal);
    const response = await this.#fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.#apiKey,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        inputs: request.inputs,
        model_id: this.#modelId,
        language_code: request.languageCode,
      }),
      signal: AbortSignal.any(signals),
    });

    if (!response.ok) {
      const detail = await errorDetail(response);
      const retryable = RETRYABLE_STATUS.has(response.status);
      const failure = new ElevenLabsError(
        `ElevenLabs text-to-dialogue failed with ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status,
        retryable,
      );
      const retryAfter = Number(response.headers.get('retry-after'));
      if (retryable && Number.isFinite(retryAfter) && retryAfter > 0) {
        throw new RetryAfter(failure, Math.min(retryAfter, 120) * 1000);
      }
      throw failure;
    }

    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0) throw new ElevenLabsError('ElevenLabs returned no audio', 200, true);
    return audio;
  }
}

/** A retryable failure that carries the server's Retry-After delay. */
class RetryAfter extends Error {
  constructor(
    readonly failure: ElevenLabsError,
    readonly ms: number,
  ) {
    super(failure.message);
  }
}

function toElevenLabsError(error: unknown): ElevenLabsError {
  if (error instanceof RetryAfter) return error.failure;
  if (error instanceof ElevenLabsError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new ElevenLabsError('ElevenLabs request was aborted', null, false);
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new ElevenLabsError('ElevenLabs request timed out', null, true);
  }
  // fetch rejects with a TypeError on network failures.
  const message = error instanceof Error ? error.message : String(error);
  return new ElevenLabsError(`ElevenLabs request failed: ${message}`, null, true);
}

/** A short, log-safe description of an error response (never includes request headers). */
async function errorDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    if (!text) return '';
    try {
      const body: unknown = JSON.parse(text);
      if (body && typeof body === 'object' && 'detail' in body) {
        const { detail } = body;
        const message =
          typeof detail === 'string'
            ? detail
            : detail && typeof detail === 'object' && 'message' in detail
              ? String(detail.message)
              : JSON.stringify(detail);
        return message.slice(0, 300);
      }
    } catch {
      // not JSON
    }
    return text.slice(0, 300);
  } catch {
    return '';
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ElevenLabsError('ElevenLabs request was aborted', null, false));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ElevenLabsError('ElevenLabs request was aborted', null, false));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
