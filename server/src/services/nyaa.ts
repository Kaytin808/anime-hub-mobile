import type { TorrentEntry } from './torrents/types';
import { scoreEpisodeMatch } from '../utils/episode-match';
import { fetchWithTimeout, isAbortError } from '../utils/fetch-timeout';
import { inferAudioLabel } from './torrents/source-meta';
import { normalizeInfoHash } from './torrents/infohash';

const NYAA_RSS = 'https://nyaa.si';

export type NyaaEntry = TorrentEntry;

class NyaaError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'NyaaError';
    this.statusCode = statusCode;
  }
}

const guessQuality = (title: string): string | undefined => {
  const match = title.match(/\b(2160p|1440p|1080p|720p|576p|480p|360p|240p|144p)\b/i);
  return match?.[1]?.toLowerCase();
};

const decodeXmlEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");

class NyaaService {
  /**
   * Search Nyaa for an anime episode, returning sorted results.
   * Tries multiple query variations: title + episode, title SxxExx format.
   * Results are sorted by seeders descending.
   */
  async searchEpisode(
    animeTitle: string,
    episodeNumber: number,
    seasonNumber?: number
  ): Promise<NyaaEntry[]> {
    const queries = this.buildQueries(animeTitle, episodeNumber, seasonNumber);
    const seen = new Set<string>();
    const results: NyaaEntry[] = [];

    const queryResults = await Promise.all(
      queries.slice(0, 5).map((query) => this.searchRss(query).catch(() => []))
    );

    for (const entries of queryResults) {
      for (const entry of entries) {
        if (!seen.has(entry.magnet)) {
          seen.add(entry.magnet);
          results.push(entry);
        }
      }
    }

    return this.sortResults(results, episodeNumber, seasonNumber).slice(0, 30);
  }

  private buildQueries(
    title: string,
    episode: number,
    season?: number
  ): string[] {
    const clean = title
      .replace(/\(TV\)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const compact = clean.replace(/[:!?,]/g, ' ').replace(/\s+/g, ' ').trim();
    const baseTitles = [...new Set([clean, compact].filter(Boolean))];

    const ep = String(episode).padStart(2, '0');
    const epShort = String(episode);

    const queries: string[] = [];

    for (const baseTitle of baseTitles) {
      if (season && season > 0) {
        const s = String(season).padStart(2, '0');
        queries.push(`${baseTitle} S${s}E${ep}`);
        queries.push(`${baseTitle} ${s}x${ep}`);
        queries.push(`${baseTitle} Season ${season} Episode ${episode}`);
      }

      queries.push(`${baseTitle} ${ep}`);
      queries.push(`${baseTitle} - ${ep}`);
      queries.push(`${baseTitle} [${ep}]`);
      queries.push(`${baseTitle} Episode ${episode}`);
      if (episode > 9) {
        queries.push(`${baseTitle} ${epShort}`);
      }
      queries.push(baseTitle);
    }

    return [...new Set(queries)];
  }

  private sortResults(results: NyaaEntry[], episodeNumber: number, seasonNumber?: number) {
    return [...results].sort((a, b) => {
      const scoreA = scoreEpisodeMatch(a.title, episodeNumber, seasonNumber);
      const scoreB = scoreEpisodeMatch(b.title, episodeNumber, seasonNumber);
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      if (b.seeders !== a.seeders) {
        return b.seeders - a.seeders;
      }
      return (b.quality || '').localeCompare(a.quality || '');
    });
  }

  private async searchRss(query: string): Promise<NyaaEntry[]> {
    const url = `${NYAA_RSS}/?page=rss&q=${encodeURIComponent(query)}&c=1_2&f=0`;

    let response: Response;
    try {
      response = await fetchWithTimeout(url, {}, 4000);
    } catch (error) {
      throw new NyaaError(
        isAbortError(error) ? 'Nyaa search timed out' : 'Nyaa search failed',
        503
      );
    }
    if (!response.ok) {
      throw new NyaaError(`Nyaa search failed: HTTP ${response.status}`, response.status);
    }

    const text = await response.text();
    return this.parseRssXml(text);
  }

  private parseRssXml(xml: string): NyaaEntry[] {
    const entries: NyaaEntry[] = [];

    const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemPattern.exec(xml)) !== null) {
      const block = itemMatch[1];

      const title = this.extractXmlTag(block, 'title');
      const seeders = parseInt(this.extractXmlTag(block, 'seeders') || '0', 10);
      const size = this.extractXmlTag(block, 'size') || '';
      const magnet = this.extractXmlTag(block, 'magnetURI') || '';
      const infoHash = this.extractXmlTag(block, 'infoHash') || '';

      if (!title || !magnet) continue;

      entries.push({
        title: decodeXmlEntities(title),
        magnet,
        infoHash: normalizeInfoHash(infoHash),
        size: decodeXmlEntities(size),
        seeders: isNaN(seeders) ? 0 : seeders,
        quality: guessQuality(title),
        audio: inferAudioLabel(title),
        source: 'nyaa'
      });
    }

    return entries;
  }

  private extractXmlTag(block: string, tagName: string): string | undefined {
    const patterns = [
      new RegExp(`<nyaa:${tagName}[^>]*>([^<]*)</nyaa:${tagName}>`, 'i'),
      new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(block);
      if (match) {
        return match[1].trim();
      }
    }

    return undefined;
  }
}

export { NyaaError };
export default new NyaaService();
