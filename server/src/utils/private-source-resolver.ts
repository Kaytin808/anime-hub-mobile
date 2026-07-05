import type { ResolvedStream } from '../services/realdebrid';
import { fetchWithTimeout } from './fetch-timeout';
import { resolveSourceLink } from './source-link-cache';

const filenameFromUrl = (url: string) => {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split('/').filter(Boolean).pop();
    return name ? decodeURIComponent(name) : undefined;
  } catch {
    return undefined;
  }
};

const hasEmbeddedSubtitleHint = (value = '') =>
  /\.(mkv)$/i.test(value) ||
  /\b(multi[\s-]?subs?|msubs?|subs?|softsubs?|ass|ssa|fansub)\b/i.test(value);

const hasEmbeddedAudioHint = (value = '') =>
  /\.(mkv)$/i.test(value) ||
  /\b(dual[\s-]?audio|multi[\s-]?audio|jpn|japanese|eng|english)\b/i.test(value);

const resolveRedirectLocation = async (url: string) => {
  const response = await fetchWithTimeout(
    url,
    {
      method: 'HEAD',
      redirect: 'manual'
    },
    10000
  );
  const location = response.headers.get('location');
  return location ? new URL(location, url).toString() : null;
};

export const resolvePrivateSourceStream = async (
  source: string,
  filename?: string
): Promise<ResolvedStream | null> => {
  if (!source.startsWith('source:')) {
    return null;
  }

  const sourceUrl = resolveSourceLink(source);
  if (sourceUrl === source) {
    return null;
  }

  const directUrl = await resolveRedirectLocation(sourceUrl);
  if (!directUrl) {
    return null;
  }

  const resolvedFilename = filename || filenameFromUrl(directUrl);

  return {
    provider: 'realdebrid',
    sourceType: 'hoster',
    filename: resolvedFilename,
    directUrl,
    subtitles: [],
    embeddedSubtitlesLikely: hasEmbeddedSubtitleHint(resolvedFilename),
    embeddedAudioTracksLikely: hasEmbeddedAudioHint(resolvedFilename)
  };
};
