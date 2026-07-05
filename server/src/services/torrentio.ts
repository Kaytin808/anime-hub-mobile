import type { TorrentEntry } from './torrents/types';
import { scoreEpisodeMatch } from '../utils/episode-match';
import { fetchWithTimeout, isAbortError } from '../utils/fetch-timeout';
import { registerSourceLink } from '../utils/source-link-cache';
import { inferAudioLabel, qualityRank } from './torrents/source-meta';
import { normalizeInfoHash } from './torrents/infohash';

const TORRENTIO_BASE = 'https://torrentio.strem.fun';

type TorrentioStream = {
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

class TorrentioError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'TorrentioError';
    this.statusCode = statusCode;
  }
}

const guessQuality = (value: string): string | undefined => {
  const match = value.match(/\b(2160p|1440p|1080p|720p|576p|480p|360p|240p|144p|4k|unknown)\b/i);
  if (!match) {
    return undefined;
  }
  return match[1].toLowerCase() === '4k' ? '2160p' : match[1].toLowerCase();
};

const extractSeeders = (title = '') => {
  const match = /\ud83d\udc64\s*(\d+)/.exec(title);
  if (!match) {
    return 0;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 0;
};

const extractSize = (title = '') => {
  const match = /\ud83d\udcbe\s*([^\n\u2699]+)/.exec(title);
  return match?.[1]?.trim() || '';
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

const buildConfigPath = (realDebridToken?: string) => {
  const config: string[] = [];

  if (realDebridToken) {
    config.push('language=japanese');
    config.push('debridoptions=nodownloadlinks,nocatalog');
    config.push(`realdebrid=${realDebridToken.trim()}`);
  }

  return config.length > 0 ? `${config.join('|')}/` : '';
};

const isCachedDebridStream = (stream: TorrentioStream, realDebridToken?: string) => {
  if (!realDebridToken) {
    return null;
  }

  const label = `${stream.name || ''} ${stream.title || ''}`;
  return /\bRD\+|\[RD\+\]|RealDebrid/i.test(label) || Boolean(stream.url);
};

class TorrentioService {
  async searchEpisode(
    imdbId: string,
    episodeNumber: number,
    seasonNumber = 1,
    realDebridToken?: string
  ): Promise<TorrentEntry[]> {
    const configPath = buildConfigPath(realDebridToken);
    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${TORRENTIO_BASE}/${configPath}stream/series/${imdbId}:${seasonNumber}:${episodeNumber}.json`,
        {},
        5000
      );
    } catch (error) {
      throw new TorrentioError(
        isAbortError(error) ? 'Torrentio search timed out' : 'Torrentio search failed',
        503
      );
    }

    if (!response.ok) {
      throw new TorrentioError(`Torrentio search failed: HTTP ${response.status}`, response.status);
    }

    const data = (await response.json()) as { streams?: TorrentioStream[] };
    const streams = Array.isArray(data.streams) ? data.streams : [];

    return streams
      .map((stream) => this.mapStream(stream, realDebridToken))
      .filter((entry): entry is TorrentEntry => Boolean(entry))
      .sort((a, b) => {
        const scoreA = scoreEpisodeMatch(a.filename || a.title, episodeNumber, seasonNumber);
        const scoreB = scoreEpisodeMatch(b.filename || b.title, episodeNumber, seasonNumber);
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        if (b.seeders !== a.seeders) {
          return b.seeders - a.seeders;
        }
        return qualityRank(b.quality) - qualityRank(a.quality);
      })
      .slice(0, realDebridToken ? 50 : 40);
  }

  private mapStream(stream: TorrentioStream, realDebridToken?: string): TorrentEntry | null {
    const infoHash = normalizeInfoHash(stream.infoHash || '');
    const streamUrl = typeof stream.url === 'string' ? stream.url : '';

    if (!infoHash && !streamUrl) {
      return null;
    }

    const title = stream.title || stream.name || infoHash || 'Torrentio RealDebrid stream';
    const filename = stream.behaviorHints?.filename || '';
    const privateSourceId = streamUrl ? registerSourceLink(streamUrl) : '';

    return {
      title,
      magnet: privateSourceId || buildMagnet(infoHash, stream.sources || []),
      infoHash: infoHash || privateSourceId,
      resolveUrl: streamUrl || undefined,
      size: extractSize(title),
      seeders: extractSeeders(title),
      cached: isCachedDebridStream(stream, realDebridToken),
      quality: guessQuality(`${stream.name || ''} ${title}`),
      audio: inferAudioLabel(`${filename} ${title}`),
      source: 'torrentio',
      fileIdx: typeof stream.fileIdx === 'number' ? stream.fileIdx : undefined,
      filename,
    };
  }
}

export { TorrentioError };
export default new TorrentioService();
