import { FastifyInstance } from 'fastify';
import { createHash } from 'crypto';
import RD, { RealDebridError, getToken } from '../../services/realdebrid';
import TorrentIndex from '../../services/torrents';
import { sortSourcesForUi } from '../../services/torrents/source-meta';
import { attachPlaybackUrls } from '../../utils/attach-playback';
import { resolvePrivateSourceStream } from '../../utils/private-source-resolver';
import { getApiBase } from '../../utils/request-base';
import { resolveSourceLink } from '../../utils/source-link-cache';

const MAX_AUTO_RESOLVE_CACHED_SOURCES = 10;
const SHOULD_AUTO_PLAY_CACHED_SOURCE = false;
const AUTO_RESOLVE_CACHE_TTL_MS = 10 * 60 * 1000;
const WEAK_AUTO_RESOLVE_CACHE_TTL_MS = 45 * 1000;
const MAX_CACHE_CHECK_HASHES = 60;
const CACHE_CHECK_TIMEOUT_MS = 2500;

type SourceCandidate = {
  title: string;
  magnet: string;
  resolveUrl?: string;
  filename?: string;
};

const getBearerToken = (authorization?: string) => {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
};

const mapSource = (entry: {
  title: string;
  magnet: string;
  quality?: string;
  audio?: string;
  size: string;
  seeders: number;
  cached?: boolean | null;
  source: string;
}) => ({
  title: entry.title,
  magnet: entry.magnet,
  quality: entry.quality,
  audio: entry.audio,
  size: entry.size,
  seeders: entry.seeders,
  cached: entry.cached,
  source: entry.source
});

type AutoResolveResponse = {
  error?: string | null;
  sources: ReturnType<typeof mapSource>[];
  streams?: ReturnType<typeof attachPlaybackUrls>;
  stream?: ReturnType<typeof attachPlaybackUrls>[number] | null;
  selectedMagnet?: string | null;
};

const autoResolveCache = new Map<string, { expiresAt: number; payload: AutoResolveResponse }>();

const normalizeCacheText = (value?: string) => (value || '').trim().toLowerCase();

const tokenCachePart = (token?: string) =>
  token ? createHash('sha256').update(token).digest('hex').slice(0, 16) : 'none';

const buildAutoResolveCacheKey = (
  body: {
    animeTitle?: string;
    originalTitle?: string;
    imdbId?: string;
    episodeNumber?: number;
    seasonNumber?: number;
    alternateEpisodeNumber?: number;
  },
  authToken?: string
) =>
  JSON.stringify({
    title: normalizeCacheText(body.animeTitle),
    originalTitle: normalizeCacheText(body.originalTitle),
    imdbId: normalizeCacheText(body.imdbId),
    episodeNumber: body.episodeNumber || 0,
    seasonNumber: body.seasonNumber || 1,
    alternateEpisodeNumber: body.alternateEpisodeNumber || 0,
    token: tokenCachePart(authToken)
  });

const getCachedAutoResolve = (key: string) => {
  const cached = autoResolveCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    autoResolveCache.delete(key);
    return null;
  }
  return cached.payload;
};

const setCachedAutoResolve = (key: string, payload: AutoResolveResponse) => {
  const hasCachedSource = payload.sources.some((source) => source.cached === true);
  const hasPlayableStream = Boolean(payload.stream || payload.streams?.length);
  const ttl = hasCachedSource || hasPlayableStream ? AUTO_RESOLVE_CACHE_TTL_MS : WEAK_AUTO_RESOLVE_CACHE_TTL_MS;

  autoResolveCache.set(key, {
    expiresAt: Date.now() + ttl,
    payload
  });

  if (autoResolveCache.size <= 200) return;

  const now = Date.now();
  for (const [cacheKey, cached] of autoResolveCache) {
    if (cached.expiresAt <= now || autoResolveCache.size > 200) {
      autoResolveCache.delete(cacheKey);
    }
  }
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> =>
  Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    })
  ]);

const resolveCandidateStreams = async (
  candidate: SourceCandidate,
  authToken: string | undefined,
  resolveOptions: {
    onlyCached?: boolean;
    episodeNumber?: number;
    seasonNumber?: number;
  }
) => {
  const filename = candidate.filename || candidate.title;
  const privateStream = await resolvePrivateSourceStream(candidate.magnet, filename);
  if (privateStream) {
    return [privateStream];
  }

  const source = resolveSourceLink(candidate.magnet);
  return RD.unrestrict(
    source === candidate.magnet && candidate.resolveUrl ? candidate.resolveUrl : source,
    authToken,
    resolveOptions
  );
};

export default async function (fastify: FastifyInstance) {
  fastify.post('/auto-resolve', async (request, reply) => {
    const body = request.body as {
      animeTitle?: string;
      originalTitle?: string;
      imdbId?: string;
      episodeNumber?: number;
      seasonNumber?: number;
      alternateEpisodeNumber?: number;
      token?: string;
    } | null;

    if (!body?.animeTitle || !body?.episodeNumber) {
      return reply.status(400).send({ error: 'missing animeTitle and episodeNumber' });
    }

    const authToken = body.token || getBearerToken(request.headers.authorization) || getToken();
    const cacheKey = buildAutoResolveCacheKey(body, authToken);
    const cachedResponse = getCachedAutoResolve(cacheKey);

    if (cachedResponse) {
      reply.header('x-auto-resolve-cache', 'hit');
      return reply.send(cachedResponse);
    }

    const sendResponse = (payload: AutoResolveResponse) => {
      setCachedAutoResolve(cacheKey, payload);
      reply.header('x-auto-resolve-cache', 'miss');
      return reply.send(payload);
    };

    const resolveOptions = {
      onlyCached: true,
      episodeNumber: body.episodeNumber,
      seasonNumber: body.seasonNumber
    };

    try {
      const searchResults = await TorrentIndex.searchEpisode(
        body.animeTitle,
        body.episodeNumber,
        body.seasonNumber,
        body.originalTitle,
        body.imdbId,
        authToken,
        body.alternateEpisodeNumber
      );

      if (searchResults.length === 0) {
        return reply.status(404).send({
          error: 'No torrents found for this episode',
          sources: []
        });
      }

      let infoMessage: string | null = null;
      let rankedSources = sortSourcesForUi(
        searchResults.map((entry) => ({
          ...entry,
          cached: entry.cached ?? null as boolean | null
        }))
      );
      let resolvedPlayback: ReturnType<typeof attachPlaybackUrls> = [];
      let selectedMagnet: string | null = null;

      const hasTrustedCachedSources =
        Boolean(authToken) && searchResults.some((entry) => entry.cached === true);

      if (!authToken) {
        infoMessage = 'Connect RealDebrid to check cache and play cached sources.';
      } else if (hasTrustedCachedSources) {
        const unknownHashes = [
          ...new Set(
            searchResults
              .filter((entry) => entry.cached !== true)
              .map((entry) => entry.infoHash.toLowerCase())
          )
        ].slice(0, MAX_CACHE_CHECK_HASHES);
        const extraCacheResults =
          unknownHashes.length > 0
            ? await withTimeout(RD.checkCaches(unknownHashes, authToken), CACHE_CHECK_TIMEOUT_MS, null)
            : null;
        rankedSources = sortSourcesForUi(
          searchResults.map((entry) => ({
            ...entry,
            cached:
              entry.cached === true
                ? true
                : extraCacheResults?.get(entry.infoHash.toLowerCase())?.cached ?? entry.cached ?? null
          }))
        );
      } else {
        try {
          const hashesToCheck = [...new Set(searchResults.map((entry) => entry.infoHash.toLowerCase()))].slice(
            0,
            MAX_CACHE_CHECK_HASHES
          );
          const cacheResults = await RD.checkCaches(
            hashesToCheck,
            authToken
          );
          const cacheChecks = searchResults.map((entry) => ({
            ...entry,
            cached:
              entry.cached === true
                ? true
                : cacheResults.get(entry.infoHash.toLowerCase())?.cached ?? false
          }));
          rankedSources = sortSourcesForUi(cacheChecks);
        } catch (error) {
          const instantAvailabilityDisabled =
            error instanceof Error && /disabled_endpoint/i.test(error.message);

          if (instantAvailabilityDisabled) {
            request.log.info(
              { err: error },
              'RealDebrid cache endpoint disabled, probing addon sources through resolver'
            );
            infoMessage = null;
          } else {
            request.log.warn({ err: error }, 'RealDebrid cache check failed, returning addon sources');
            infoMessage =
              error instanceof Error
                ? `RealDebrid cache check failed: ${error.message}. Showing addon sources without cache status.`
                : 'RealDebrid cache check failed. Showing addon sources without cache status.';
          }

          const probeLimit = Math.min(rankedSources.length, MAX_AUTO_RESOLVE_CACHED_SOURCES);
          const probedStates = new Map<string, boolean>();

          for (const candidate of rankedSources.slice(0, probeLimit)) {
            try {
              const streams = await resolveCandidateStreams(candidate, authToken, resolveOptions);
              const playable = streams.length > 0;
              probedStates.set(candidate.magnet, playable);

              if (playable && resolvedPlayback.length === 0) {
                resolvedPlayback = attachPlaybackUrls(streams, getApiBase(request));
                selectedMagnet = candidate.magnet;
              }
            } catch (probeError) {
              request.log.warn(
                { err: probeError, magnet: candidate.magnet },
                'RealDebrid probe failed for addon source'
              );
              probedStates.set(candidate.magnet, false);
            }
          }

          rankedSources = sortSourcesForUi(
            rankedSources.map((entry) => ({
              ...entry,
              cached: probedStates.has(entry.magnet) ? probedStates.get(entry.magnet)! : entry.cached
            }))
          );
        }
      }

      const apiBase = getApiBase(request);
      const cachedSources = authToken ? rankedSources.filter((entry) => entry.cached === true) : [];

      if (resolvedPlayback.length > 0) {
        return sendResponse({
          error: infoMessage,
          sources: rankedSources.map(mapSource),
          streams: resolvedPlayback,
          stream: resolvedPlayback[0] || null,
          selectedMagnet
        });
      }

      if (!SHOULD_AUTO_PLAY_CACHED_SOURCE && cachedSources.length > 0) {
        return sendResponse({
          error: infoMessage,
          sources: rankedSources.map(mapSource),
          streams: [],
          stream: null,
          selectedMagnet: null
        });
      }

      for (const candidate of cachedSources.slice(0, MAX_AUTO_RESOLVE_CACHED_SOURCES)) {
        try {
          const streams = await resolveCandidateStreams(candidate, authToken, resolveOptions);
          if (streams.length === 0) {
            continue;
          }

          const withPlayback = attachPlaybackUrls(streams, apiBase);
          return sendResponse({
            error: infoMessage,
            sources: rankedSources.map(mapSource),
            streams: withPlayback,
            stream: withPlayback[0] || null,
            selectedMagnet: candidate.magnet
          });
        } catch (error) {
          request.log.warn(
            { err: error, magnet: candidate.magnet },
            'cached source failed to resolve, trying next'
          );
        }
      }

      return sendResponse({
        error:
          infoMessage ||
          (cachedSources.length > MAX_AUTO_RESOLVE_CACHED_SOURCES
            ? `Tried the top ${MAX_AUTO_RESOLVE_CACHED_SOURCES} cached sources, but none resolved into a playable stream. Pick another cached source below.`
            : null),
        sources: rankedSources.map(mapSource),
        streams: [],
        stream: null
      });
    } catch (error) {
      request.log.error(error);
      const statusCode = error instanceof RealDebridError ? error.statusCode : 500;
      return reply.status(statusCode).send({
        error: error instanceof Error ? error.message : 'failed to auto-resolve',
        sources: [],
        streams: [],
        stream: null
      });
    }
  });
}
