import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PODCAST_SPEECH_TEMPO } from '@notebook-lite/shared';

/** Audio operations of the podcast pipeline (ffmpeg in production, fakes in tests). */
export interface AudioTools {
  /**
   * Concatenates MP3 files in order into `output`, sped up to the podcast tempo and re-encoded
   * to a uniform 128 kbps.
   */
  concatMp3(inputs: readonly string[], output: string, signal?: AbortSignal): Promise<void>;
  /** Duration of an audio file in seconds. */
  durationSeconds(file: string, signal?: AbortSignal): Promise<number>;
}

export type RunCommand = (
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<{ stdout: string }>;

/** Runs a command without a shell; rejects with the tail of stderr on a non-zero exit. */
export const runCommand: RunCommand = (command, args, signal) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], signal });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT' ? new Error(`${command} is not installed or not on PATH`) : error,
      );
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout });
      else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });

/** Escapes a path for an ffmpeg concat list (`file '…'`). */
export function concatListEntry(file: string): string {
  return `file '${file.replaceAll("'", "'\\''")}'`;
}

export class FfmpegAudio implements AudioTools {
  constructor(
    private readonly run: RunCommand = runCommand,
    /** Playback tempo; ffmpeg's `atempo` accepts 0.5–100 and keeps the pitch. */
    private readonly tempo: number = PODCAST_SPEECH_TEMPO,
  ) {}

  async concatMp3(inputs: readonly string[], output: string, signal?: AbortSignal): Promise<void> {
    if (inputs.length === 0) throw new Error('nothing to concatenate');
    const list = path.join(path.dirname(output), 'concat.txt');
    await writeFile(
      list,
      `${inputs.map((file) => concatListEntry(path.resolve(file))).join('\n')}\n`,
    );
    await this.run(
      'ffmpeg',
      // prettier-ignore
      [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'concat', '-safe', '0', '-i', list,
        '-vn', '-af', `atempo=${this.tempo}`, '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100',
        output,
      ],
      signal,
    );
  }

  async durationSeconds(file: string, signal?: AbortSignal): Promise<number> {
    const { stdout } = await this.run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      signal,
    );
    const seconds = Number.parseFloat(stdout.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error(`ffprobe reported no duration for ${path.basename(file)}`);
    }
    return Math.round(seconds * 100) / 100;
  }
}
