import fs from 'fs';
import { spawn } from 'child_process';

const resolveOptionalModulePath = (moduleName: string, exportName?: string) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const loaded = require(moduleName);
    return exportName ? loaded?.[exportName] : loaded;
  } catch {
    return undefined;
  }
};

const resolveExecutablePath = (envPath: string | undefined, modulePath: string | undefined, fallbackName: string) => {
  if (envPath && fs.existsSync(envPath)) return envPath;
  if (modulePath && fs.existsSync(modulePath)) return modulePath;
  return fallbackName;
};

const FFMPEG_PATH = resolveExecutablePath(
  process.env.FFMPEG_PATH,
  resolveOptionalModulePath('ffmpeg-static'),
  'ffmpeg'
);

const FFPROBE_PATH = resolveExecutablePath(
  process.env.FFPROBE_PATH,
  resolveOptionalModulePath('ffprobe-static', 'path'),
  'ffprobe'
);

export type ProbedTrack = {
  index: number;
  codecType: 'video' | 'audio' | 'subtitle' | string;
  codecName?: string;
  codecLongName?: string;
  language?: string;
  title?: string;
  channels?: number;
  disposition?: Record<string, number>;
};

export type ProbedMediaInfo = {
  formatName?: string;
  duration?: number;
  videoTracks: ProbedTrack[];
  audioTracks: ProbedTrack[];
  subtitleTracks: ProbedTrack[];
};

const readProcess = (command: string, args: string[]) =>
  new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });

export const hasFfmpeg = () => FFMPEG_PATH === 'ffmpeg' || fs.existsSync(FFMPEG_PATH);
export const hasFfprobe = () => FFPROBE_PATH === 'ffprobe' || fs.existsSync(FFPROBE_PATH);
export const getFfmpegPath = () => FFMPEG_PATH;
export const getFfprobePath = () => FFPROBE_PATH;

export async function probeMedia(url: string): Promise<ProbedMediaInfo> {
  if (!hasFfprobe()) {
    throw new Error('ffprobe is not installed');
  }

  const args = [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    url
  ];

  const result = await readProcess(FFPROBE_PATH, args);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || 'ffprobe failed');
  }

  const parsed = JSON.parse(result.stdout) as {
    format?: { format_name?: string; duration?: string };
    streams?: Array<{
      index: number;
      codec_type: string;
      codec_name?: string;
      codec_long_name?: string;
      channels?: number;
      disposition?: Record<string, number>;
      tags?: Record<string, string>;
    }>;
  };

  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const mapped: ProbedTrack[] = streams.map((stream) => ({
    index: stream.index,
    codecType: stream.codec_type,
    codecName: stream.codec_name,
    codecLongName: stream.codec_long_name,
    language: stream.tags?.language,
    title: stream.tags?.title,
    channels: stream.channels,
    disposition: stream.disposition
  }));

  return {
    formatName: parsed.format?.format_name,
    duration: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
    videoTracks: mapped.filter((track) => track.codecType === 'video'),
    audioTracks: mapped.filter((track) => track.codecType === 'audio'),
    subtitleTracks: mapped.filter((track) => track.codecType === 'subtitle')
  };
}
