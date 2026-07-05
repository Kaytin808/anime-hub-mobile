import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'stream';
import { getPlaybackUrl } from '../../utils/playback-cache';
import { getFfmpegPath, getFfprobePath, hasFfmpeg, hasFfprobe, probeMedia } from '../../utils/ffmpeg';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { attachPlaybackUrls } from '../../utils/attach-playback';
import { getApiBase } from '../../utils/request-base';

const MEDIA_INFO_CACHE_TTL_MS = 15 * 60 * 1000;
const SUBTITLE_CACHE_TTL_MS = 30 * 60 * 1000;
const TEST_VIDEO_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const mediaInfoCache = new Map<string, CacheEntry<Awaited<ReturnType<typeof probeMedia>>>>();
const mediaInfoPending = new Map<string, Promise<Awaited<ReturnType<typeof probeMedia>>>>();
const subtitleCache = new Map<string, CacheEntry<string>>();
const subtitlePending = new Map<string, Promise<string>>();
const hlsJobs = new Map<string, { dir: string; startedAt: number; process?: ReturnType<typeof spawn> }>();

const looksLikeSrt = (text: string) =>
  /\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(text);

const convertSrtToVtt = (text: string) => {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r+/g, '');
  const body = normalized.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );
  return `WEBVTT\n\n${body}`;
};

const getCached = <T,>(cache: Map<string, CacheEntry<T>>, key: string) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
};

const setCached = <T,>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
  return value;
};

const waitForFile = async (filePath: string, timeoutMs = 12000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return false;
};

const getMediaInfoCached = async (playbackId: string, targetUrl: string) => {
  const cached = getCached(mediaInfoCache, playbackId);
  if (cached) return cached;

  const pending = mediaInfoPending.get(playbackId);
  if (pending) return pending;

  const promise = probeMedia(targetUrl)
    .then((mediaInfo) => setCached(mediaInfoCache, playbackId, mediaInfo, MEDIA_INFO_CACHE_TTL_MS))
    .finally(() => {
      mediaInfoPending.delete(playbackId);
    });

  mediaInfoPending.set(playbackId, promise);
  return promise;
};

const extractSubtitleText = async (targetUrl: string, streamIndex: number, codecName: string) => {
  const normalizedCodec = codecName.toLowerCase();
  const isAss = normalizedCodec === 'ass' || normalizedCodec === 'ssa';
  const isSrt = normalizedCodec === 'subrip' || normalizedCodec === 'srt';
  const outputExtension = isAss ? 'ass' : isSrt ? 'srt' : 'vtt';
  const outputFormat = isAss ? 'ass' : isSrt ? 'srt' : 'webvtt';
  const codecArgs = isAss || isSrt ? ['-c:s', 'copy'] : ['-c:s', 'webvtt'];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anime-hub-sub-'));
  const outputPath = path.join(tempDir, `subtitle-${streamIndex}.${outputExtension}`);

  const args = [
    '-y',
    '-v',
    'error',
    '-i',
    targetUrl,
    '-map',
    `0:${streamIndex}`,
    '-map_metadata',
    '-1',
    ...codecArgs,
    '-f',
    outputFormat,
    outputPath
  ];

  try {
    const child = spawn(getFfmpegPath(), args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });

    if (exitCode && exitCode !== 0) {
      throw new Error(stderr.trim() || 'ffmpeg subtitle extraction exited with error');
    }

    const rawText = await fs.readFile(outputPath, 'utf8');
    return {
      subtitleText: looksLikeSrt(rawText) ? convertSrtToVtt(rawText) : rawText,
      outputFormat,
      convertedToVtt: looksLikeSrt(rawText),
      extractedLength: rawText.length
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

export default async function (fastify: FastifyInstance) {
  const proxyVideo = async (request: FastifyRequest, reply: FastifyReply, targetUrl: string) => {
    const range = request.headers.range;
    const headers: Record<string, string> = {
      'User-Agent': 'AnimeHub/1.0'
    };
    if (range) {
      headers.Range = range;
    }

    try {
      const upstream = await fetch(targetUrl, {
        method: 'GET',
        headers,
        redirect: 'follow'
      });

      if (!upstream.ok && upstream.status !== 206) {
        return reply.status(upstream.status).send({ error: 'upstream playback request failed' });
      }

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      reply.status(upstream.status);
      reply.header('Content-Type', contentType);
      reply.header('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
      reply.header('Cache-Control', 'no-store');

      const contentLength = upstream.headers.get('content-length');
      const contentRange = upstream.headers.get('content-range');
      if (contentLength) reply.header('Content-Length', contentLength);
      if (contentRange) reply.header('Content-Range', contentRange);

      if (!upstream.body) {
        return reply.send('');
      }

      const nodeStream = Readable.fromWeb(upstream.body as import('stream/web').ReadableStream);
      return reply.send(nodeStream);
    } catch (error) {
      request.log.error(error);
      return reply.status(502).send({ error: 'failed to proxy playback stream' });
    }
  };

  fastify.get('/test-video', async (request, reply) => {
    return proxyVideo(request, reply, TEST_VIDEO_URL);
  });

  fastify.get('/test-playback', async (request, reply) => {
    const streams = attachPlaybackUrls(
      [
        {
          provider: 'demo' as const,
          sourceType: 'demo' as const,
          quality: '720p',
          container: 'mp4',
          codec: 'h264',
          filename: 'anime-hub-mobile-playback-test.mp4',
          directUrl: TEST_VIDEO_URL,
          subtitles: []
        }
      ],
      getApiBase(request)
    );

    return reply.send({
      stream: streams[0],
      streams
    });
  });

  /**
   * Proxy a previously resolved RealDebrid stream for in-browser playback.
   * Supports Range requests so seeking works.
   */
  fastify.get('/play/:playbackId', async (request, reply) => {
    const params = request.params as { playbackId: string };
    const targetUrl = getPlaybackUrl(params.playbackId);

    if (!targetUrl) {
      return reply.status(404).send({ error: 'playback link expired or not found' });
    }

    return proxyVideo(request, reply, targetUrl);
  });

  fastify.get('/play/:playbackId/media-info', async (request, reply) => {
    const params = request.params as { playbackId: string };
    const targetUrl = getPlaybackUrl(params.playbackId);

    if (!targetUrl) {
      return reply.status(404).send({ error: 'playback link expired or not found' });
    }

    if (!hasFfprobe()) {
      return reply.status(503).send({ error: 'ffprobe is not installed', ffprobePath: getFfprobePath() });
    }

    try {
      const mediaInfo = await getMediaInfoCached(params.playbackId, targetUrl);
      request.log.info(
        {
          playbackId: params.playbackId,
          audioTracks: mediaInfo.audioTracks,
          subtitleTracks: mediaInfo.subtitleTracks
        },
        'ffprobe media-info'
      );
      return reply.send(mediaInfo);
    } catch (error) {
      request.log.error({ err: error, playbackId: params.playbackId }, 'ffprobe media-info failed');
      return reply.status(500).send({
        error: error instanceof Error ? error.message : 'ffprobe media-info failed'
      });
    }
  });

  fastify.get('/play/:playbackId/ios.mp4', async (request, reply) => {
    const params = request.params as { playbackId: string };
    const targetUrl = getPlaybackUrl(params.playbackId);

    if (!targetUrl) {
      return reply.status(404).send({ error: 'playback link expired or not found' });
    }

    if (!hasFfmpeg()) {
      return reply.status(503).send({ error: 'ffmpeg is not installed', ffmpegPath: getFfmpegPath() });
    }

    const args = [
      '-v',
      'error',
      '-i',
      targetUrl,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      'frag_keyframe+empty_moov+faststart',
      '-f',
      'mp4',
      'pipe:1'
    ];

    const child = spawn(getFfmpegPath(), args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      request.log.error({ err: error, playbackId: params.playbackId }, 'ffmpeg iOS remux failed');
      if (!reply.sent) {
        reply.status(500).send({ error: 'ffmpeg iOS remux failed' });
      }
    });

    child.on('close', (code) => {
      if (code && code !== 0) {
        request.log.error({ playbackId: params.playbackId, code, stderr }, 'ffmpeg iOS remux exited with error');
      }
    });

    reply.header('Content-Type', 'video/mp4');
    reply.header('Cache-Control', 'no-store');
    return reply.send(child.stdout);
  });

  fastify.get('/play/:playbackId/iphone.mp4', async (request, reply) => {
    const params = request.params as { playbackId: string };
    const targetUrl = getPlaybackUrl(params.playbackId);

    if (!targetUrl) {
      return reply.status(404).send({ error: 'playback link expired or not found' });
    }

    if (!hasFfmpeg()) {
      return reply.status(503).send({ error: 'ffmpeg is not installed', ffmpegPath: getFfmpegPath() });
    }

    const args = [
      '-v',
      'error',
      '-i',
      targetUrl,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-sn',
      '-dn',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'zerolatency',
      '-profile:v',
      'main',
      '-level',
      '4.0',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-ac',
      '2',
      '-movflags',
      'frag_keyframe+empty_moov+faststart',
      '-f',
      'mp4',
      'pipe:1'
    ];

    const child = spawn(getFfmpegPath(), args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      request.log.error({ err: error, playbackId: params.playbackId }, 'ffmpeg iPhone transcode failed');
      if (!reply.sent) {
        reply.status(500).send({ error: 'ffmpeg iPhone transcode failed' });
      }
    });

    child.on('close', (code) => {
      if (code && code !== 0) {
        request.log.error({ playbackId: params.playbackId, code, stderr }, 'ffmpeg iPhone transcode exited with error');
      }
    });

    reply.header('Content-Type', 'video/mp4');
    reply.header('Cache-Control', 'no-store');
    return reply.send(child.stdout);
  });

  fastify.get('/play/:playbackId/hls/index.m3u8', async (request, reply) => {
    const params = request.params as { playbackId: string };
    const targetUrl = getPlaybackUrl(params.playbackId);

    if (!targetUrl) {
      return reply.status(404).send({ error: 'playback link expired or not found' });
    }

    if (!hasFfmpeg()) {
      return reply.status(503).send({ error: 'ffmpeg is not installed', ffmpegPath: getFfmpegPath() });
    }

    let job = hlsJobs.get(params.playbackId);
    if (!job) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), `anime-hub-hls-${params.playbackId}-`));
      const playlistPath = path.join(dir, 'index.m3u8');
      const segmentPattern = path.join(dir, 'segment-%05d.ts');
      const args = [
        '-v',
        'warning',
        '-i',
        targetUrl,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-sn',
        '-dn',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-profile:v',
        'main',
        '-level',
        '4.0',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-ac',
        '2',
        '-hls_time',
        '6',
        '-hls_list_size',
        '0',
        '-hls_flags',
        'independent_segments',
        '-hls_segment_filename',
        segmentPattern,
        playlistPath
      ];

      const child = spawn(getFfmpegPath(), args, {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });

      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('close', (code) => {
        if (code && code !== 0) {
          request.log.error({ playbackId: params.playbackId, code, stderr }, 'ffmpeg HLS transcode exited with error');
        }
      });

      job = { dir, process: child, startedAt: Date.now() };
      hlsJobs.set(params.playbackId, job);
    }

    const playlistPath = path.join(job.dir, 'index.m3u8');
    const ready = await waitForFile(playlistPath);
    if (!ready) {
      return reply.status(503).send({ error: 'HLS stream is still preparing' });
    }

    reply.header('Content-Type', 'application/vnd.apple.mpegurl');
    reply.header('Cache-Control', 'no-store');
    return reply.send(await fs.readFile(playlistPath, 'utf8'));
  });

  fastify.get('/play/:playbackId/hls/:file', async (request, reply) => {
    const params = request.params as { playbackId: string; file: string };
    const job = hlsJobs.get(params.playbackId);
    if (!job || !/^(segment-\d+\.ts|index\.m3u8)$/.test(params.file)) {
      return reply.status(404).send({ error: 'HLS segment not found' });
    }

    const filePath = path.join(job.dir, params.file);
    const ready = await waitForFile(filePath, 5000);
    if (!ready) {
      return reply.status(404).send({ error: 'HLS segment not ready' });
    }

    reply.header('Content-Type', params.file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    reply.header('Cache-Control', 'no-store');
    return reply.send(await fs.readFile(filePath));
  });

  fastify.get('/play/:playbackId/subtitle/:streamIndex', async (request, reply) => {
    const params = request.params as { playbackId: string; streamIndex: string };
    const targetUrl = getPlaybackUrl(params.playbackId);

    if (!targetUrl) {
      return reply.status(404).send({ error: 'playback link expired or not found' });
    }

    if (!hasFfmpeg()) {
      return reply.status(503).send({ error: 'ffmpeg is not installed', ffmpegPath: getFfmpegPath() });
    }

    const streamIndex = Number(params.streamIndex);
    if (!Number.isFinite(streamIndex)) {
      return reply.status(400).send({ error: 'invalid subtitle stream index' });
    }

    let codecName = 'subrip';
    try {
      const mediaInfo = await getMediaInfoCached(params.playbackId, targetUrl);
      const matchedTrack = mediaInfo.subtitleTracks.find((track) => track.index === streamIndex);
      codecName = matchedTrack?.codecName || codecName;
    } catch (error) {
      request.log.warn(
        { err: error, playbackId: params.playbackId, streamIndex },
        'unable to probe subtitle codec, falling back to default extraction'
      );
    }

    const cacheKey = `${params.playbackId}:${streamIndex}`;
    const cachedSubtitle = getCached(subtitleCache, cacheKey);
    if (cachedSubtitle) {
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Subtitle-Cache', 'hit');
      return reply.send(cachedSubtitle);
    }

    try {
      const pending = subtitlePending.get(cacheKey);
      const extraction = pending
        ? {
            subtitleText: await pending,
            outputFormat: codecName,
            convertedToVtt: false,
            extractedLength: 0
          }
        : await (() => {
            const extractionPromise = extractSubtitleText(targetUrl, streamIndex, codecName);
            subtitlePending.set(
              cacheKey,
              extractionPromise
                .then((result) => result.subtitleText)
                .finally(() => {
                  subtitlePending.delete(cacheKey);
                })
            );
            return extractionPromise;
          })();

      setCached(subtitleCache, cacheKey, extraction.subtitleText, SUBTITLE_CACHE_TTL_MS);

      request.log.info(
        {
          playbackId: params.playbackId,
          streamIndex,
          codecName,
          outputFormat: extraction.outputFormat,
          extractedLength: extraction.extractedLength,
          convertedToVtt: extraction.convertedToVtt
        },
        'ffmpeg subtitle extraction complete'
      );

      reply.header('Content-Type', 'text/plain; charset=utf-8');
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Subtitle-Cache', pending ? 'waited' : 'miss');
      return reply.send(extraction.subtitleText);
    } catch (error) {
      request.log.error({ err: error, playbackId: params.playbackId, streamIndex, codecName }, 'ffmpeg subtitle extraction failed');
      return reply.status(500).send({ error: 'ffmpeg subtitle extraction failed' });
    }
  });

  fastify.get('/play/:playbackId/audio/:streamIndex', async (request, reply) => {
    const params = request.params as { playbackId: string; streamIndex: string };
    const query = request.query as { start?: string };
    const targetUrl = getPlaybackUrl(params.playbackId);

    if (!targetUrl) {
      return reply.status(404).send({ error: 'playback link expired or not found' });
    }

    if (!hasFfmpeg()) {
      return reply.status(503).send({ error: 'ffmpeg is not installed', ffmpegPath: getFfmpegPath() });
    }

    const streamIndex = Number(params.streamIndex);
    if (!Number.isFinite(streamIndex)) {
      return reply.status(400).send({ error: 'invalid audio stream index' });
    }

    const startSeconds = Number(query.start || 0);
    const hasStartOffset = Number.isFinite(startSeconds) && startSeconds > 0;

    const args = [
      '-v',
      'error',
      '-i',
      targetUrl,
      ...(hasStartOffset ? ['-ss', String(startSeconds)] : []),
      '-map',
      '0:v:0',
      '-map',
      `0:${streamIndex}`,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      'frag_keyframe+empty_moov+faststart',
      '-f',
      'mp4',
      'pipe:1'
    ];

    const child = spawn(getFfmpegPath(), args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      request.log.error({ err: error, playbackId: params.playbackId, streamIndex }, 'ffmpeg audio remux failed');
      if (!reply.sent) {
        reply.status(500).send({ error: 'ffmpeg audio remux failed' });
      }
    });

    child.on('close', (code) => {
      if (code && code !== 0) {
        request.log.error(
          { playbackId: params.playbackId, streamIndex, code, stderr },
          'ffmpeg audio remux exited with error'
        );
      }
    });

    reply.header('Content-Type', 'video/mp4');
    reply.header('Cache-Control', 'no-store');
    return reply.send(child.stdout);
  });
}
