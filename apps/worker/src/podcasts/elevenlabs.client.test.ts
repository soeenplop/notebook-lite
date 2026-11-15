import { describe, expect, it, vi } from 'vitest';
import { DIALOGUE_MAX_CHARS, ElevenLabsClient, ElevenLabsError } from './elevenlabs.client.js';
import { buildDialogueBatches, splitText } from './tts-batches.js';

const inputs = [
  { text: 'Hallo!', voice_id: 'voice-a' },
  { text: 'Hallo zurück.', voice_id: 'voice-b' },
];

function audioResponse(bytes = [1, 2, 3]) {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  });
}

function client(
  fetch: typeof globalThis.fetch,
  sleep = vi.fn<(ms: number, signal?: AbortSignal) => Promise<void>>(() => Promise.resolve()),
) {
  return {
    sleep,
    client: new ElevenLabsClient({
      apiKey: 'xi-test-key',
      modelId: 'eleven_v3',
      baseUrl: 'https://elevenlabs.test/',
      fetch,
      sleep,
      random: () => 0.5,
      baseDelayMs: 100,
      maxRetries: 2,
    }),
  };
}

describe('ElevenLabsClient', () => {
  it('posts the dialogue with model, language and MP3 output format', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(audioResponse()));
    const audio = await client(fetch).client.synthesize({ inputs, languageCode: 'de' });

    expect([...audio]).toEqual([1, 2, 3]);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://elevenlabs.test/v1/text-to-dialogue?output_format=mp3_44100_128');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'xi-api-key': 'xi-test-key' });
    expect(JSON.parse(init?.body as string)).toEqual({
      inputs,
      model_id: 'eleven_v3',
      language_code: 'de',
    });
  });

  it('retries rate limits and server errors with backoff', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(new Response('oops', { status: 503 }))
      .mockResolvedValueOnce(audioResponse());
    const { client: c, sleep } = client(fetch);
    await expect(c.synthesize({ inputs, languageCode: 'en' })).resolves.toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([100, 200]);
  });

  it('honours Retry-After', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '7' } }))
      .mockResolvedValueOnce(audioResponse());
    const { client: c, sleep } = client(fetch);
    await c.synthesize({ inputs, languageCode: 'en' });
    expect(sleep.mock.calls[0]?.[0]).toBe(7000);
  });

  it('retries network failures', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(audioResponse());
    await expect(
      client(fetch).client.synthesize({ inputs, languageCode: 'en' }),
    ).resolves.toBeDefined();
  });

  it('gives up after the retry limit', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response('busy', { status: 429 })),
    );
    await expect(client(fetch).client.synthesize({ inputs, languageCode: 'en' })).rejects.toThrow(
      /failed with 429/,
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry client errors and reports the detail without the key', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        Response.json(
          { detail: { status: 'voice_not_found', message: 'Voice not found' } },
          { status: 400 },
        ),
      ),
    );
    const error = await client(fetch)
      .client.synthesize({ inputs, languageCode: 'en' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ElevenLabsError);
    expect(error).toMatchObject({ status: 400, retryable: false });
    expect(String(error)).toContain('Voice not found');
    expect(String(error)).not.toContain('xi-test-key');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects requests over the character limit before calling the API', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      client(fetch).client.synthesize({
        inputs: [{ text: 'x'.repeat(DIALOGUE_MAX_CHARS + 1), voice_id: 'v' }],
        languageCode: 'en',
      }),
    ).rejects.toThrow(/limit is 2000/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('buildDialogueBatches', () => {
  const voices = { A: 'voice-a', B: 'voice-b' };

  it('packs segments into batches below the limit, breaking at segment boundaries', () => {
    const segments = [
      { speaker: 'A' as const, text: 'a'.repeat(40) },
      { speaker: 'B' as const, text: 'b'.repeat(40) },
      { speaker: 'A' as const, text: 'c'.repeat(40) },
    ];
    const batches = buildDialogueBatches(segments, voices, 100);
    expect(batches).toEqual([
      [
        { text: 'a'.repeat(40), voice_id: 'voice-a' },
        { text: 'b'.repeat(40), voice_id: 'voice-b' },
      ],
      [{ text: 'c'.repeat(40), voice_id: 'voice-a' }],
    ]);
  });

  it('splits a segment longer than the limit at sentences', () => {
    const text = 'One two three. Four five six. Seven eight nine.';
    const batches = buildDialogueBatches([{ speaker: 'A', text }], voices, 30);
    expect(batches.flat().map((input) => input.text)).toEqual([
      'One two three. Four five six.',
      'Seven eight nine.',
    ]);
    for (const batch of batches) {
      expect(batch.reduce((sum, input) => sum + input.text.length, 0)).toBeLessThanOrEqual(30);
    }
  });

  it('keeps a realistic 15-minute script within the documented limit', () => {
    const segments = Array.from({ length: 120 }, (_, i) => ({
      speaker: i % 2 === 0 ? ('A' as const) : ('B' as const),
      text: 'This is a sentence of a long podcast script. '.repeat(3).trim(),
    }));
    const batches = buildDialogueBatches(segments, voices);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      expect(batch.reduce((sum, input) => sum + input.text.length, 0)).toBeLessThanOrEqual(
        DIALOGUE_MAX_CHARS,
      );
    }
    expect(batches.flat()).toHaveLength(120);
  });

  it('requires a voice for every speaker used', () => {
    expect(() =>
      buildDialogueBatches([{ speaker: 'B', text: 'Hi' }], { A: 'voice-a', B: undefined }),
    ).toThrow(/speaker B/);
  });

  it('splits overlong sentences at words', () => {
    expect(splitText('aaa bbb ccc ddd', 7)).toEqual(['aaa bbb', 'ccc ddd']);
    expect(splitText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
});
