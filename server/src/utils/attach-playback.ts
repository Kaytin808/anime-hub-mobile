import { buildPlaybackUrl } from './playback-url';
import { registerPlaybackUrl } from './playback-cache';

export const attachPlaybackUrls = <T extends { directUrl: string }>(
  streams: T[],
  apiBase?: string
): (T & { playbackUrl: string })[] =>
  streams.map((stream) => {
    const playbackId = registerPlaybackUrl(stream.directUrl);
    return {
      ...stream,
      playbackUrl: buildPlaybackUrl(playbackId, apiBase)
    };
  });
