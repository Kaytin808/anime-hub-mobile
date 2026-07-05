import { fetchWithTimeout } from '../utils/fetch-timeout';

const JIKAN_SEARCH_URL = 'https://api.jikan.moe/v4/anime';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type JikanTitle = {
  type?: string;
  title?: string;
};

type JikanAnime = {
  title?: string;
  title_english?: string;
  title_japanese?: string;
  titles?: JikanTitle[];
};

type CacheEntry = {
  expiresAt: number;
  aliases: string[];
};

const aliasCache = new Map<string, CacheEntry>();

const normalizeKey = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const addAlias = (aliases: Set<string>, value?: string) => {
  const alias = (value || '').replace(/\s+/g, ' ').trim();
  if (alias.length >= 3 && alias.length <= 120) {
    aliases.add(alias);
  }
};

class AnimeAliasService {
  async getAliases(titles: string[]): Promise<string[]> {
    const searchTitle = titles.find((title) => /[a-z0-9]/i.test(title)) || titles[0];
    if (!searchTitle) return [];

    const cacheKey = normalizeKey(searchTitle);
    const cached = aliasCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.aliases;
    }

    const aliases = new Set<string>();

    try {
      const params = new URLSearchParams({
        q: searchTitle,
        limit: '3'
      });
      const response = await fetchWithTimeout(`${JIKAN_SEARCH_URL}?${params.toString()}`, {}, 1600);
      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as { data?: JikanAnime[] };
      const sourceTitleKeys = new Set(titles.map(normalizeKey).filter(Boolean));
      const records = Array.isArray(data.data) ? data.data : [];

      for (const record of records) {
        const recordTitles = [
          record.title,
          record.title_english,
          record.title_japanese,
          ...(record.titles || []).map((title) => title.title)
        ].filter((title): title is string => Boolean(title));
        const recordKeys = recordTitles.map(normalizeKey);
        const likelyMatch =
          recordKeys.some((key) => sourceTitleKeys.has(key)) ||
          recordKeys.some((key) => [...sourceTitleKeys].some((sourceKey) => key.includes(sourceKey) || sourceKey.includes(key)));

        if (!likelyMatch) {
          continue;
        }

        for (const title of recordTitles) {
          addAlias(aliases, title);
        }
      }
    } catch {
      // Alias lookup is only a search enhancer; source lookup should keep working without it.
    }

    const aliasList = [...aliases].filter((alias) => !titles.some((title) => normalizeKey(title) === normalizeKey(alias)));
    aliasCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      aliases: aliasList
    });

    return aliasList;
  }
}

export default new AnimeAliasService();
