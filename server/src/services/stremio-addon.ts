import type { TorrentEntry, TorrentSource } from './torrents/types';
import { scoreEpisodeMatch } from '../utils/episode-match';
import { fetchWithTimeout, isAbortError } from '../utils/fetch-timeout';
import { registerSourceLink } from '../utils/source-link-cache';
import { inferAudioLabel, qualityRank } from './torrents/source-meta';
import { normalizeInfoHash } from './torrents/infohash';

type StremioStream = {
  infoHash?: string;
  fileIdx?: number;
  name?: string;
  title?: string;
  url?: string;
  behaviorHints?: {
    filename?: string;
  };
  sources?: string[];
};

class StremioAddonError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'StremioAddonError';
    this.statusCode = statusCode;
  }
}

const normalizeBaseUrl = (value: string) =>
  value
    .trim()
    .replace(/\/manifest\.json$/i, '')
    .replace(/\/configure\/?$/i, '')
    .replace(/\/+$/, '');

const splitBaseUrls = (value: string | undefined, fallbacks: string[]) => {
  const configured = (value || '')
    .split(',')
    .map(normalizeBaseUrl)
    .filter(Boolean);

  return [...new Set([...configured, ...fallbacks.map(normalizeBaseUrl)])];
};

const guessQuality = (value: string): string | undefined => {
  const match = value.match(/\b(2160p|1440p|1080p|720p|576p|480p|360p|240p|144p|4k|unknown)\b/i);
  if (!match) return undefined;
  return match[1].toLowerCase() === '4k' ? '2160p' : match[1].toLowerCase();
};

const extractSeeders = (title = '') => {
  const emojiMatch = /\ud83d\udc64\s*(\d+)/.exec(title);
  const textMatch = /\b(?:seeders?|seeds?)\D{0,6}(\d+)\b/i.exec(title);
  const value = Number(emojiMatch?.[1] || textMatch?.[1] || 0);
  return Number.isFinite(value) ? value : 0;
};

const extractSize = (title = '') => {
  const emojiMatch = /\ud83d\udcbe\s*([^\n\u2699]+)/.exec(title);
  const textMatch = /\b(\d+(?:\.\d+)?\s*(?:GB|GiB|MB|MiB))\b/i.exec(title);
  return emojiMatch?.[1]?.trim() || textMatch?.[1]?.trim() || '';
};

const buildMagnet = (infoHash: string, sources: string[] = []) => {
  const params = new URLSearchParams();
  params.set('xt', `urn:btih:${infoHash}`);

  for (const source of sources) {
    if (source.startsWith('tracker:')) {
      params.append('tr', source.slice('tracker:'.length));
    }
  }

  return `magnet:?${params.toString()}`;
};

const isCachedDebridStream = (stream: StremioStream) => {
  const label = `${stream.name || ''} ${stream.title || ''}`;
  if (/\b(RD\+|\[RD\+\]|cached|RealDebrid|Debrid)\b/i.test(label) || Boolean(stream.url)) {
    return true;
  }
  return null;
};

class StremioAddonService {
  constructor(
    private readonly source: TorrentSource,
    private readonly baseUrls: string[],
    private readonly displayName: string
  ) {}

  async searchEpisode(
    imdbId: string,
    episodeNumber: number,
    seasonNumber = 1
  ): Promise<TorrentEntry[]> {
    const id = `${imdbId}:${seasonNumber}:${episodeNumber}`;
    const resultsByBase = await Promise.all(
      this.baseUrls.map((baseUrl) =>
        this.searchBaseUrl(baseUrl, id, episodeNumber, seasonNumber).catch(() => [])
      )
    );
    const seen = new Set<string>();
    const merged: TorrentEntry[] = [];

    for (const entry of resultsByBase.flat()) {
      if (seen.has(entry.infoHash)) {
        continue;
      }
      seen.add(entry.infoHash);
      merged.push(entry);
    }

    return merged
      .sort((a, b) => {
        const scoreA = scoreEpisodeMatch(a.filename || a.title, episodeNumber, seasonNumber);
        const scoreB = scoreEpisodeMatch(b.filename || b.title, episodeNumber, seasonNumber);
        if (scoreB !== scoreA) return scoreB - scoreA;
        if (b.seeders !== a.seeders) return b.seeders - a.seeders;
        return qualityRank(b.quality) - qualityRank(a.quality);
      })
      .slice(0, 50);
  }

  private async searchBaseUrl(
    baseUrl: string,
    id: string,
    episodeNumber: number,
    seasonNumber: number
  ) {
    let response: Response;
    try {
      response = await fetchWithTimeout(`${baseUrl}/stream/series/${id}.json`, {}, 4500);
    } catch (error) {
      throw new StremioAddonError(
        isAbortError(error) ? `${this.displayName} search timed out` : `${this.displayName} search failed`,
        503
      );
    }

    if (!response.ok) {
      throw new StremioAddonError(`${this.displayName} search failed: HTTP ${response.status}`, response.status);
    }

    const data = (await response.json()) as { streams?: StremioStream[] };
    const streams = Array.isArray(data.streams) ? data.streams : [];

    return streams
      .map((stream) => this.mapStream(stream))
      .filter((entry): entry is TorrentEntry => Boolean(entry))
      .sort((a, b) => {
        const scoreA = scoreEpisodeMatch(a.filename || a.title, episodeNumber, seasonNumber);
        const scoreB = scoreEpisodeMatch(b.filename || b.title, episodeNumber, seasonNumber);
        if (scoreB !== scoreA) return scoreB - scoreA;
        if (b.seeders !== a.seeders) return b.seeders - a.seeders;
        return qualityRank(b.quality) - qualityRank(a.quality);
      })
      .slice(0, 50);
  }

  private mapStream(stream: StremioStream): TorrentEntry | null {
    const infoHash = normalizeInfoHash(stream.infoHash || '');
    const streamUrl = typeof stream.url === 'string' ? stream.url : '';

    if (!infoHash && !streamUrl) {
      return null;
    }

    const title = stream.title || stream.name || infoHash || `${this.displayName} stream`;
    const filename = stream.behaviorHints?.filename || '';
    const privateSourceId = streamUrl ? registerSourceLink(streamUrl) : '';

    return {
      title,
      magnet: privateSourceId || buildMagnet(infoHash, stream.sources || []),
      infoHash: infoHash || privateSourceId,
      resolveUrl: streamUrl || undefined,
      size: extractSize(title),
      seeders: extractSeeders(title),
      cached: isCachedDebridStream(stream),
      quality: guessQuality(`${stream.name || ''} ${title}`),
      audio: inferAudioLabel(`${filename} ${title}`),
      source: this.source,
      fileIdx: typeof stream.fileIdx === 'number' ? stream.fileIdx : undefined,
      filename
    };
  }
}

export const Comet = new StremioAddonService(
  'comet',
  splitBaseUrls(process.env.COMET_ADDON_URLS || process.env.COMET_ADDON_URL, [
    'https://comet.elfhosted.com'
  ]),
  'Comet'
);

export const Otaku = new StremioAddonService(
  'otaku',
  splitBaseUrls(process.env.OTAKU_ADDON_URLS || process.env.OTAKU_ADDON_URL, [
    'https://otaku.elfhosted.com',
    'https://otaku.strem.fun'
  ]),
  'Otaku'
);

export { StremioAddonError };
