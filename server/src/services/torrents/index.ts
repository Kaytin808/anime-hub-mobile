import AnimeTosho from '../animetosho';
import AnimeAliases from '../anime-aliases';
import Nyaa from '../nyaa';
import { Comet, Otaku } from '../stremio-addon';
import Torrentio from '../torrentio';
import { scoreEpisodeMatch } from '../../utils/episode-match';
import { scoreTitleRelevance } from '../../utils/title-match';
import type { TorrentEntry } from './types';

const qualityRank = (quality?: string) => {
  const order = ['2160p', '1440p', '1080p', '720p', '480p', '360p'];
  const index = quality ? order.indexOf(quality) : -1;
  return index === -1 ? -1 : order.length - index;
};

const normalizeAliasKey = (value?: string) =>
  (value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const TITLE_ALIASES: Record<string, string[]> = {
  'tt31889371': ['Tsue to Tsurugi no Wistoria'],
  'wistoria wand and sword': ['Tsue to Tsurugi no Wistoria']
};
const MIN_CACHED_ADDON_RESULTS_BEFORE_FAST_RETURN = 8;
const MAX_FALLBACK_TITLES = 4;

const getManualSearchAliases = (titles: string[], imdbId?: string) => {
  const aliases = new Set<string>();

  if (imdbId && TITLE_ALIASES[imdbId]) {
    for (const alias of TITLE_ALIASES[imdbId]) aliases.add(alias);
  }

  for (const title of titles) {
    const key = normalizeAliasKey(title);
    for (const alias of TITLE_ALIASES[key] || []) aliases.add(alias);
  }

  return [...aliases];
};

const episodeCandidates = (episodeNumber: number, alternateEpisodeNumber?: number) =>
  [...new Set([episodeNumber, alternateEpisodeNumber].filter((episode): episode is number =>
    Boolean(episode && Number.isFinite(episode) && episode > 0)
  ))];

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> =>
  Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    })
  ]);

class TorrentIndexService {
  async searchEpisode(
    animeTitle: string,
    episodeNumber: number,
    seasonNumber?: number,
    alternateTitle?: string,
    imdbId?: string,
    realDebridToken?: string,
    alternateEpisodeNumber?: number
  ): Promise<TorrentEntry[]> {
    const titles = [animeTitle, alternateTitle]
      .map((title) => title?.trim())
      .filter((title, index, list): title is string => Boolean(title && list.indexOf(title) === index));
    const aliasTitles = await withTimeout(AnimeAliases.getAliases(titles), 1800, []);
    const searchTitles = [...new Set([...titles, ...getManualSearchAliases(titles, imdbId), ...aliasTitles])].slice(0, 8);
    const episodesToSearch = episodeCandidates(episodeNumber, alternateEpisodeNumber);

    const seen = new Set<string>();
    const results: TorrentEntry[] = [];
    const searchFallbackIndexes = () =>
      Promise.all(searchTitles.slice(0, MAX_FALLBACK_TITLES).flatMap((title) =>
        episodesToSearch.map((episode) =>
          withTimeout(this.searchEpisodeForTitle(title, episode, seasonNumber), 3200, [])
        )
      ));

    if (imdbId) {
      const [torrentioResults, broadTorrentioResults, cometResults, otakuResults] = await Promise.all([
        Torrentio.searchEpisode(imdbId, episodeNumber, seasonNumber, realDebridToken).catch(() => []),
        realDebridToken
          ? Torrentio.searchEpisode(imdbId, episodeNumber, seasonNumber).catch(() => [])
          : Promise.resolve([]),
        Comet.searchEpisode(imdbId, episodeNumber, seasonNumber).catch(() => []),
        Otaku.searchEpisode(imdbId, episodeNumber, seasonNumber).catch(() => [])
      ]);

      for (const entry of this.filterByTitleRelevance(
        [...torrentioResults, ...broadTorrentioResults, ...cometResults, ...otakuResults],
        searchTitles,
        6
      )) {
        if (!seen.has(entry.infoHash)) {
          seen.add(entry.infoHash);
          results.push(entry);
        }
      }

      const cachedAddonCount = results.filter((entry) => entry.cached === true).length;
      if (realDebridToken && cachedAddonCount >= MIN_CACHED_ADDON_RESULTS_BEFORE_FAST_RETURN) {
        return this.sortResults(results, searchTitles, episodeNumber, seasonNumber);
      }
    }

    const titleSearches = await searchFallbackIndexes();

    for (const entries of titleSearches) {
      for (const entry of entries) {
        if (!seen.has(entry.infoHash)) {
          seen.add(entry.infoHash);
          results.push(entry);
        }
      }
    }

    return this.sortResults(results, searchTitles, episodeNumber, seasonNumber);
  }

  private async searchEpisodeForTitle(
    animeTitle: string,
    episodeNumber: number,
    seasonNumber?: number
  ): Promise<TorrentEntry[]> {
    const [nyaaResults, toshoResults] = await Promise.all([
      Nyaa.searchEpisode(animeTitle, episodeNumber, seasonNumber).catch(() => []),
      AnimeTosho.searchEpisode(animeTitle, episodeNumber, seasonNumber).catch(() => [])
    ]);

    const seen = new Set<string>();
    const merged: TorrentEntry[] = [];

    for (const entry of this.filterByTitleRelevance([...nyaaResults, ...toshoResults], [animeTitle], 6)) {
      if (seen.has(entry.infoHash)) {
        continue;
      }
      seen.add(entry.infoHash);
      merged.push(entry);
    }

    return this.sortResults(merged, [animeTitle], episodeNumber, seasonNumber);
  }

  private filterByTitleRelevance(
    entries: TorrentEntry[],
    titles: string[],
    minimumScore: number
  ) {
    return entries.filter((entry) => {
      const candidate = [entry.title, entry.filename].filter(Boolean).join(' ');
      return scoreTitleRelevance(candidate, titles) >= minimumScore;
    });
  }

  private sortResults(
    results: TorrentEntry[],
    titles: string[],
    episodeNumber: number,
    seasonNumber?: number
  ) {
    return [...results].sort((a, b) => {
      const titleScoreA = scoreTitleRelevance([a.title, a.filename].filter(Boolean).join(' '), titles);
      const titleScoreB = scoreTitleRelevance([b.title, b.filename].filter(Boolean).join(' '), titles);
      if (titleScoreB !== titleScoreA) {
        return titleScoreB - titleScoreA;
      }

      const scoreA = scoreEpisodeMatch(a.filename || a.title, episodeNumber, seasonNumber);
      const scoreB = scoreEpisodeMatch(b.filename || b.title, episodeNumber, seasonNumber);
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      if (b.seeders !== a.seeders) {
        return b.seeders - a.seeders;
      }
      return qualityRank(b.quality) - qualityRank(a.quality);
    });
  }
}

export type { TorrentEntry, TorrentSource } from './types';
export default new TorrentIndexService();
