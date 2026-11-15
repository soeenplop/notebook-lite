import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PODCAST_SPEECH_TEMPO } from '@notebook-lite/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { concatListEntry, FfmpegAudio, type RunCommand, runCommand } from './audio.js';

const hasFfmpeg =
  spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'podcast-audio-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FfmpegAudio (mocked commands)', () => {
  it('concatenates with the concat demuxer, speeds up and re-encodes to 128 kbps', async () => {
    const run = vi.fn<RunCommand>(() => Promise.resolve({ stdout: '' }));
    const inputs = [path.join(dir, 'batch-0.mp3'), path.join(dir, "it's batch-1.mp3")];
    await new FfmpegAudio(run).concatMp3(inputs, path.join(dir, 'podcast.mp3'));

    const [command, args] = run.mock.calls[0] ?? [];
    expect(command).toBe('ffmpeg');
    expect(args).toEqual(expect.arrayContaining(['-f', 'concat', '-b:a', '128k', '-c:a']));
    expect(args).toEqual(expect.arrayContaining(['-af', `atempo=${PODCAST_SPEECH_TEMPO}`]));
    expect(args?.at(-1)).toBe(path.join(dir, 'podcast.mp3'));
    const list = await readFile(path.join(dir, 'concat.txt'), 'utf8');
    expect(list).toBe(`${inputs.map(concatListEntry).join('\n')}\n`);
    expect(list).toContain("it'\\''s batch-1.mp3");
  });

  it('reads the duration with ffprobe', async () => {
    const run = vi.fn<RunCommand>(() => Promise.resolve({ stdout: '361.523000\n' }));
    await expect(new FfmpegAudio(run).durationSeconds('x.mp3')).resolves.toBe(361.52);
    expect(run.mock.calls[0]?.[0]).toBe('ffprobe');

    const empty = vi.fn<RunCommand>(() => Promise.resolve({ stdout: 'N/A' }));
    await expect(new FfmpegAudio(empty).durationSeconds('x.mp3')).rejects.toThrow(/no duration/);
  });

  it('reports a missing binary clearly', async () => {
    await expect(runCommand('definitely-not-a-binary-xyz', [])).rejects.toThrow(/not installed/);
  });
});

describe.skipIf(!hasFfmpeg)('FfmpegAudio (real ffmpeg)', () => {
  it('joins generated MP3s, speeds them up and measures the result', async () => {
    const inputs = [0, 1].map((n) => path.join(dir, `batch-${n}.mp3`));
    await Promise.all(
      inputs.map((file, n) =>
        // prettier-ignore
        runCommand('ffmpeg', [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'lavfi', '-i', `sine=frequency=${440 + n * 220}:duration=1`,
          '-c:a', 'libmp3lame', '-b:a', '64k', file,
        ]),
      ),
    );
    const audio = new FfmpegAudio(runCommand, 1.25);
    const output = path.join(dir, 'podcast.mp3');
    await audio.concatMp3(inputs, output);
    const duration = await audio.durationSeconds(output);
    // 2 s of input at 1.25× tempo ≈ 1.6 s.
    expect(duration).toBeGreaterThan(1.4);
    expect(duration).toBeLessThan(1.9);
  });
});
