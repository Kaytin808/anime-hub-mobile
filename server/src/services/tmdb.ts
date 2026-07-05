import { fetchWithTimeout, isAbortError } from '../utils/fetch-timeout';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';
const JAPANESE_ANIMATION_FILTER = {
  with_genres: '16',
  with_original_language: 'ja'
};
const FRONT_PAGE_NSFw_PATTERNS = [
  /\bhentai\b/i,
  /\becchi\b/i,
  /\badult animation\b/i,
  /\bexplicit\b/i,
  /\berotic\b/i,
  /\buncensored\b/i,
  /\bsexual\b/i,
  /\bporn(?:ographic)?\b/i,
  /\bnud(?:e|ity)\b/i
];

type JsonRecord = Record<string, unknown>;

export type AnimeSummary = {
  id: number;
  title: string;
  originalTitle?: string;
  overview: string;
  posterUrl?: string;
  backdropUrl?: string;
  firstAirDate?: string;
  voteAverage?: number;
  popularity?: number;
};

export type AnimeEpisode = {
  id: number;
  episodeNumber: number;
  seasonNumber: number;
  title: string;
  overview: string;
  airDate?: string;
  stillUrl?: string;
  runtime?: number;
};

class TmdbError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'TmdbError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const getApiKey = () => process.env.TMDB_API_KEY || '';

const imageUrl = (path: unknown, size: 'w342' | 'w500' | 'w780' | 'original' = 'w500') =>
  typeof path === 'string' && path ? `${IMAGE_BASE}/${size}${path}` : undefined;

const asNumber = (value: unknown) => (typeof value === 'number' ? value : undefined);
const asString = (value: unknown) => (typeof value === 'string' ? value : undefined);
const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);
const plusDays = (date: Date, days: number) => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};
const isAnimeTvItem = (item: JsonRecord) => {
  const genreIds = Array.isArray(item.genre_ids) ? item.genre_ids : [];
  return item.original_language === 'ja' && genreIds.includes(16);
};
const isFrontPageSafe = (item: JsonRecord) => {
  const text = `${asString(item.name) || ''} ${asString(item.original_name) || ''} ${asString(item.overview) || ''}`.trim();
  return !FRONT_PAGE_NSFw_PATTERNS.some((pattern) => pattern.test(text));
};
const dedupeById = <T extends { id: number }>(items: T[]) => {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
};

const getSeasonRange = (offset = 0, now = new Date()) => {
  const currentMonth = now.getUTCMonth();
  const currentYear = now.getUTCFullYear();
  const seasonStartMonth = Math.floor(currentMonth / 3) * 3;

  const targetMonthIndex = seasonStartMonth + offset * 3;
  const year = currentYear + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;

  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 3, 0));

  return {
    start,
    end,
    label: `${start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${start.getUTCFullYear()}`
  };
};

class TmdbService {
  async getTrending(page = 1) {
    const items = await this.collectCatalog(
      '/discover/tv',
      {
        ...JAPANESE_ANIMATION_FILTER,
        sort_by: 'popularity.desc',
        include_adult: 'false'
      },
      { startPage: page, maxPages: 3, limit: 24 }
    );

    return { results: items };
  }

  async search(query: string, page = 1) {
    if (!query.trim()) {
      return this.getTrending(page);
    }

    const data = await this.request<{ results?: JsonRecord[] }>('/search/tv', {
      query,
      include_adult: 'false',
      page: String(page)
    });

    const results = this.mapSafeSummaries(
      (data.results || []).filter((item) => {
        const genreIds = Array.isArray(item.genre_ids) ? item.genre_ids : [];
        return item.original_language === 'ja' && genreIds.includes(16);
      })
    );

    return { results };
  }

  async getDetails(id: string) {
    return this.request<JsonRecord>(`/tv/${id}`, {
      append_to_response: 'content_ratings,external_ids'
    }).then((data) => ({
      id: asNumber(data.id),
      title: asString(data.name) || asString(data.original_name) || 'Untitled anime',
      originalTitle: asString(data.original_name),
      imdbId:
        data.external_ids && typeof data.external_ids === 'object'
          ? asString((data.external_ids as JsonRecord).imdb_id)
          : undefined,
      overview: asString(data.overview) || '',
      posterUrl: imageUrl(data.poster_path, 'w780'),
      backdropUrl: imageUrl(data.backdrop_path, 'original'),
      firstAirDate: asString(data.first_air_date),
      lastAirDate: asString(data.last_air_date),
      status: asString(data.status),
      voteAverage: asNumber(data.vote_average),
      popularity: asNumber(data.popularity),
      numberOfSeasons: asNumber(data.number_of_seasons),
      numberOfEpisodes: asNumber(data.number_of_episodes),
      seasons: Array.isArray(data.seasons)
        ? data.seasons.map((season) => this.mapSeason(season as JsonRecord))
        : []
    }));
  }

  async getSeason(id: string, seasonNumber: string) {
    const data = await this.request<JsonRecord>(`/tv/${id}/season/${seasonNumber}`);
    return {
      id: asNumber(data.id),
      seasonNumber: asNumber(data.season_number),
      title: asString(data.name) || `Season ${seasonNumber}`,
      overview: asString(data.overview) || '',
      posterUrl: imageUrl(data.poster_path, 'w780'),
      airDate: asString(data.air_date),
      episodes: Array.isArray(data.episodes)
        ? data.episodes.map((episode) => this.mapEpisode(episode as JsonRecord))
        : []
    };
  }

  async getAiringToday(page = 1) {
    const data = await this.request<{ results?: JsonRecord[] }>('/tv/airing_today', {
      timezone: 'America/Phoenix',
      page: String(page)
    });

    return {
      results: this.mapSafeSummaries((data.results || []).filter(isAnimeTvItem))
    };
  }

  async getOnTheAir(page = 1) {
    const data = await this.request<{ results?: JsonRecord[] }>('/tv/on_the_air', {
      page: String(page)
    });

    return {
      results: this.mapSafeSummaries((data.results || []).filter(isAnimeTvItem))
    };
  }

  async getHomeRows() {
    const thisSeason = getSeasonRange(0);
    const nextSeason = getSeasonRange(1);

    const trendingNowPromise = this.collectCatalog(
      '/discover/tv',
      {
        ...JAPANESE_ANIMATION_FILTER,
        include_adult: 'false',
        sort_by: 'popularity.desc',
        'air_date.gte': toIsoDate(plusDays(new Date(), -21)),
        'air_date.lte': toIsoDate(plusDays(new Date(), 21))
      },
      { maxPages: 4, limit: 18 }
    );

    const popularThisSeasonPromise = this.collectCatalog(
      '/discover/tv',
      {
        ...JAPANESE_ANIMATION_FILTER,
        include_adult: 'false',
        sort_by: 'popularity.desc',
        'first_air_date.gte': toIsoDate(thisSeason.start),
        'first_air_date.lte': toIsoDate(thisSeason.end)
      },
      { maxPages: 4, limit: 18 }
    );

    const upcomingNextSeasonPromise = this.collectCatalog(
      '/discover/tv',
      {
        ...JAPANESE_ANIMATION_FILTER,
        include_adult: 'false',
        sort_by: 'popularity.desc',
        'first_air_date.gte': toIsoDate(nextSeason.start),
        'first_air_date.lte': toIsoDate(nextSeason.end)
      },
      { maxPages: 4, limit: 18 }
    );

    const [trendingNowData, popularThisSeasonData, upcomingNextSeasonData] = await Promise.all([
      trendingNowPromise,
      popularThisSeasonPromise,
      upcomingNextSeasonPromise
    ]);

    const trendingNow = dedupeById(trendingNowData).slice(0, 18);
    const popularThisSeason = dedupeById(popularThisSeasonData).slice(0, 18);
    const upcomingNextSeason = dedupeById(upcomingNextSeasonData).slice(0, 18);

    return {
      trendingNow,
      popularThisSeason,
      upcomingNextSeason,
      meta: {
        thisSeason: thisSeason.label,
        nextSeason: nextSeason.label,
        curatedAt: toIsoDate(plusDays(new Date(), 0))
      }
    };
  }

  private mapSafeSummaries(items: JsonRecord[]) {
    return items
      .filter(isAnimeTvItem)
      .filter(isFrontPageSafe)
      .map((item) => this.mapSummary(item))
      .filter((item) => item.posterUrl);
  }

  private async collectCatalog(
    path: string,
    params: Record<string, string>,
    options: { startPage?: number; maxPages?: number; limit?: number } = {}
  ) {
    const startPage = options.startPage || 1;
    const maxPages = options.maxPages || 1;
    const limit = options.limit || 18;
    const pageRequests: Promise<{ results?: JsonRecord[] }>[] = [];

    for (let page = startPage; page < startPage + maxPages; page += 1) {
      pageRequests.push(
        this.request<{ results?: JsonRecord[] }>(path, {
          ...params,
          page: String(page)
        })
      );
    }

    const pages = await Promise.all(pageRequests);
    return dedupeById(this.mapSafeSummaries(pages.flatMap((page) => page.results || []))).slice(0, limit);
  }

  private mapSummary(item: JsonRecord): AnimeSummary {
    return {
      id: Number(item.id),
      title: asString(item.name) || asString(item.original_name) || 'Untitled anime',
      originalTitle: asString(item.original_name),
      overview: asString(item.overview) || '',
      posterUrl: imageUrl(item.poster_path, 'w780'),
      backdropUrl: imageUrl(item.backdrop_path, 'original'),
      firstAirDate: asString(item.first_air_date),
      voteAverage: asNumber(item.vote_average),
      popularity: asNumber(item.popularity)
    };
  }

  private mapSeason(season: JsonRecord) {
    return {
      id: asNumber(season.id),
      seasonNumber: asNumber(season.season_number),
      title: asString(season.name) || `Season ${String(season.season_number ?? '')}`,
      episodeCount: asNumber(season.episode_count),
      airDate: asString(season.air_date),
      posterUrl: imageUrl(season.poster_path, 'w780')
    };
  }

  private mapEpisode(episode: JsonRecord): AnimeEpisode {
    return {
      id: Number(episode.id),
      episodeNumber: Number(episode.episode_number),
      seasonNumber: Number(episode.season_number),
      title: asString(episode.name) || `Episode ${String(episode.episode_number ?? '')}`,
      overview: asString(episode.overview) || '',
      airDate: asString(episode.air_date),
      stillUrl: imageUrl(episode.still_path, 'w780'),
      runtime: asNumber(episode.runtime)
    };
  }

  private async request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new TmdbError('TMDB_API_KEY is not configured', 500);
    }

    const searchParams = new URLSearchParams({
      api_key: apiKey,
      language: 'en-US',
      ...params
    });

    let response: Response;
    try {
      response = await fetchWithTimeout(`${TMDB_API_BASE}${path}?${searchParams.toString()}`, {}, 10000);
    } catch (error) {
      throw new TmdbError(
        isAbortError(error)
          ? 'TMDB took too long to respond. Try again in a moment.'
          : 'Unable to reach the TMDB API. Check your internet connection, VPN, DNS, or firewall settings.',
        503,
        error
      );
    }
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;

    if (!response.ok) {
      const message =
        data && typeof data === 'object' && 'status_message' in data
          ? String((data as JsonRecord).status_message)
          : `TMDB request failed with HTTP ${response.status}`;
      throw new TmdbError(message, response.status, data);
    }

    return data as T;
  }
}

export { TmdbError };
export default new TmdbService();
