import type { TorrentEntry } from './torrents/types';
import { fetchWithTimeout, isAbortError } from '../utils/fetch-timeout';
import { inferAudioLabel } from './torrents/source-meta';
import { normalizeInfoHash } from './torrents/infohash';

const FEED_BASE = 'https://feed.animetosho.org/json';

type JsonRecord = Record<string, unknown>;

class AnimeToshoError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'AnimeToshoError';
    this.statusCode = statusCode;
  }
}

const guessQuality = (title: string): string | undefined => {
  const match = title.match(/\b(2160p|1440p|1080p|720p|576p|480p|360p|240p|144p)\b/i);
  return match?.[1]?.toLowerCase();
};

const extractInfoHash = (magnet: string, fallback?: string): string => {
  const match = magnet.match(/btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  return normalizeInfoHash(match?.[1] || fallback || '');
};

const formatBytes = (bytes: unknown): string => {
  const value = typeof bytes === 'number' ? bytes : Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

class AnimeToshoService {
  async searchEpisode(
    animeTitle: string,
    episodeNumber: number,
    seasonNumber?: number
  ): Promise<TorrentEntry[]> {
    const queries = this.buildQueries(animeTitle, episodeNumber, seasonNumber);
    const seen = new Set<string>();
    const results: TorrentEntry[] = [];

    const queryResults = await Promise.all(
      queries.slice(0, 4).map((query) => this.searchJson(query).catch(() => []))
    );

    for (const entries of queryResults) {
      for (const entry of entries) {
        if (!seen.has(entry.infoHash)) {
          seen.add(entry.infoHash);
          results.push(entry);
        }
      }
    }

    return results.sort((a, b) => b.seeders - a.seeders);
  }

  private buildQueries(title: string, episode: number, season?: number): string[] {
    const clean = title
      .replace(/\(TV\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const ep = String(episode).padStart(2, '0');
    const queries: string[] = [];

    if (season && season > 0) {
      const s = String(season).padStart(2, '0');
      queries.push(`${clean} S${s}E${ep}`);
      queries.push(`${clean} ${s}x${ep}`);
    }

    queries.push(`${clean} ${ep}`);
    queries.push(`${clean} - ${episode}`);

    return queries;
  }

  private async searchJson(query: string): Promise<TorrentEntry[]> {
    const params = new URLSearchParams({
      q: query,
      num: '25'
    });

    let response: Response;
    try {
      response = await fetchWithTimeout(`${FEED_BASE}?${params.toString()}`, {}, 4000);
    } catch (error) {
      throw new AnimeToshoError(
        isAbortError(error) ? 'AnimeTosho search timed out' : 'AnimeTosho search failed',
        503
      );
    }
    if (!response.ok) {
      throw new AnimeToshoError(`AnimeTosho search failed: HTTP ${response.status}`, response.status);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }

    return data
      .map((item) => this.mapEntry(item as JsonRecord))
      .filter((entry): entry is TorrentEntry => Boolean(entry));
  }

  private mapEntry(item: JsonRecord): TorrentEntry | null {
    const title = typeof item.title === 'string' ? item.title : '';
    const magnet =
      typeof item.magnet_uri === 'string'
        ? item.magnet_uri
        : typeof item.magnet === 'string'
        ? item.magnet
        : '';

    if (!title || !magnet) {
      return null;
    }

    const infoHash = extractInfoHash(magnet);
    if (!infoHash) {
      return null;
    }

    const seeders =
      typeof item.seeders === 'number'
        ? item.seeders
        : typeof item.seeds === 'number'
        ? item.seeds
        : 0;

    const size =
      typeof item.totalsize === 'number'
        ? formatBytes(item.totalsize)
        : typeof item.size === 'string'
        ? item.size
        : '';

    return {
      title,
      magnet,
      infoHash,
      size,
      seeders: Number.isFinite(seeders) ? seeders : 0,
      quality: guessQuality(title),
      audio: inferAudioLabel(title),
      source: 'animetosho'
    };
  }
}

export { AnimeToshoError };
export default new AnimeToshoService();
