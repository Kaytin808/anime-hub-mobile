import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkCheck, BookmarkPlus, ChevronLeft, PlayCircle } from 'lucide-react';
import VideoPlayer from '../../components/VideoPlayer';
import { useRealDebrid } from '../../context/RealDebridContext';
import { isSavedShow, removeShow, saveShow } from '../../utils/library';
import { getWatchProgress, saveWatchProgress } from '../../utils/watch-progress';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const SOURCE_BATCH_SIZE = 6;

type AnimeDetails = {
  id: number;
  title: string;
  originalTitle?: string;
  imdbId?: string;
  overview: string;
  posterUrl?: string;
  backdropUrl?: string;
  firstAirDate?: string;
  status?: string;
  voteAverage?: number;
  numberOfEpisodes?: number;
  seasons: SeasonSummary[];
};

type SeasonSummary = {
  id?: number;
  seasonNumber?: number;
  title: string;
  episodeCount?: number;
};

type Episode = {
  id: number;
  episodeNumber: number;
  seasonNumber: number;
  title: string;
  overview: string;
  airDate?: string;
  stillUrl?: string;
  runtime?: number;
};

type Source = {
  title: string;
  magnet: string;
  quality?: string;
  audio?: string;
  size: string;
  seeders: number;
  cached?: boolean | null;
  source: string;
};

type Stream = {
  playbackUrl?: string;
  directUrl?: string;
  quality?: string;
  container?: string;
  filename?: string;
  subtitles?: string[];
  embeddedSubtitlesLikely?: boolean;
  embeddedAudioTracksLikely?: boolean;
};

const getPlaybackId = (url?: string) => {
  if (!url) return null;
  const match = url.match(/\/streams\/play\/([^/?]+)/);
  return match?.[1] || null;
};

const isEpisodeReleased = (episode: Episode) => {
  if (!episode.airDate) return true;
  const releaseDate = new Date(`${episode.airDate}T00:00:00`);
  if (Number.isNaN(releaseDate.getTime())) return true;
  return releaseDate.getTime() <= Date.now();
};

const formatAirDate = (value?: string) => {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
};

export default function AnimePage() {
  const router = useRouter();
  const id = useMemo(() => {
    const queryId = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
    const normalize = (value?: string) => {
      const trimmed = value ? String(value).trim() : '';
      if (!trimmed || trimmed === '[id]' || trimmed === 'undefined' || trimmed === 'null') return '';
      return trimmed;
    };
    const normalizedQueryId = normalize(queryId ? String(queryId) : '');
    if (normalizedQueryId) return normalizedQueryId;

    const path = router.asPath.split('?')[0];
    const match = path.match(/^\/anime\/([^/]+)/);
    return match ? normalize(decodeURIComponent(match[1])) : '';
  }, [router.asPath, router.query.id]);
  const { token, status } = useRealDebrid();
  const requestedSeason = useMemo(() => {
    const raw = Array.isArray(router.query.season) ? router.query.season[0] : router.query.season;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [router.query.season]);
  const requestedEpisodeNumber = useMemo(() => {
    const raw = Array.isArray(router.query.episode) ? router.query.episode[0] : router.query.episode;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  }, [router.query.episode]);
  const requestedResumeTime = useMemo(() => {
    const raw = Array.isArray(router.query.resume) ? router.query.resume[0] : router.query.resume;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [router.query.resume]);
  const autoplayRequested = useMemo(() => {
    const raw = Array.isArray(router.query.autoplay) ? router.query.autoplay[0] : router.query.autoplay;
    return raw === '1' || raw === 'true';
  }, [router.query.autoplay]);
  const [anime, setAnime] = useState<AnimeDetails | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [activeStream, setActiveStream] = useState<Stream | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvingEpisodeId, setResolvingEpisodeId] = useState<number | null>(null);
  const [resolvingSourceMagnet, setResolvingSourceMagnet] = useState<string | null>(null);
  const [selectedSourceMagnet, setSelectedSourceMagnet] = useState<string | null>(null);
  const [visibleSourceLimit, setVisibleSourceLimit] = useState(SOURCE_BATCH_SIZE);
  const [saved, setSaved] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [error, setError] = useState('');
  const [preloadedStreams, setPreloadedStreams] = useState<Record<string, Stream[]>>({});
  const autoResolvedEpisodeKey = useRef<string | null>(null);
  const autoplayConsumedRef = useRef<string | null>(null);
  const preloadEpisodeKeyRef = useRef<string | null>(null);
  const episodeSourcePrefetchRef = useRef<Set<string>>(new Set());
  const warmedPlaybackIdsRef = useRef<Set<string>>(new Set());
  const sourceListRef = useRef<HTMLDivElement | null>(null);
  const sourceLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const lastDesktopProgressWriteRef = useRef(0);

  const usableSeasons = useMemo(
    () => (anime?.seasons || []).filter((season) => (season.seasonNumber || 0) > 0),
    [anime]
  );

  const visibleSources = useMemo(() => {
    const playableCandidates = sources.filter((source) => source.cached !== false);
    return playableCandidates.length > 0 ? playableCandidates : sources;
  }, [sources]);

  const shownSources = useMemo(
    () => visibleSources.slice(0, visibleSourceLimit),
    [visibleSourceLimit, visibleSources]
  );
  const hasMoreSources = visibleSourceLimit < visibleSources.length;
  const nextEpisode = useMemo(() => {
    if (!selectedEpisode) return null;
    return (
      episodes.find(
        (episode) =>
          episode.seasonNumber === selectedEpisode.seasonNumber &&
          episode.episodeNumber === selectedEpisode.episodeNumber + 1
      ) || null
    );
  }, [episodes, selectedEpisode]);
  const resumeTime = useMemo(() => {
    if (requestedResumeTime > 0) return requestedResumeTime;
    if (!anime || !selectedEpisode) return 0;

    const key = `${anime.id}:${selectedEpisode.seasonNumber || 1}:${selectedEpisode.episodeNumber}`;
    const item = getWatchProgress().find((progress) => progress.key === key);
    if (!item || !Number.isFinite(item.currentTime) || item.currentTime <= 0) return 0;
    if (item.duration > 0 && item.currentTime >= item.duration - 90) return 0;
    return Math.max(0, item.currentTime - 3);
  }, [anime, requestedResumeTime, selectedEpisode]);

  useEffect(() => {
    if (!anime || !selectedEpisode || !window.desktopPlayer?.onState) return;

    return window.desktopPlayer.onState((state) => {
      const currentTime = Number(state.currentTime) || 0;
      const duration = Number(state.duration) || (selectedEpisode.runtime ? Number(selectedEpisode.runtime) * 60 : 0);
      if (currentTime <= 0 || Date.now() - lastDesktopProgressWriteRef.current < 2500) return;

      lastDesktopProgressWriteRef.current = Date.now();
      saveWatchProgress({
        key: `${anime.id}:${selectedEpisode.seasonNumber || 1}:${selectedEpisode.episodeNumber}`,
        showId: anime.id,
        showTitle: anime.title,
        posterUrl: anime.posterUrl,
        backdropUrl: anime.backdropUrl,
        seasonNumber: selectedEpisode.seasonNumber,
        episodeNumber: selectedEpisode.episodeNumber,
        episodeTitle: selectedEpisode.title,
        stillUrl: selectedEpisode.stillUrl,
        runtime: selectedEpisode.runtime,
        currentTime,
        duration,
        updatedAt: Date.now(),
        nextAirDate: nextEpisode?.airDate
      });
    });
  }, [anime, nextEpisode?.airDate, selectedEpisode]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!id) {
      void router.replace('/');
      return;
    }

    async function loadDetails() {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/anime/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Unable to load anime');

        setAnime(data);
        setSaved(isSavedShow(data.id));
        const firstSeason = (data.seasons || []).find((season: SeasonSummary) => (season.seasonNumber || 0) > 0);
        const availableSeasons = (data.seasons || []).map((season: SeasonSummary) => season.seasonNumber).filter(Boolean);
        const nextSeason = requestedSeason && availableSeasons.includes(requestedSeason)
          ? requestedSeason
          : firstSeason?.seasonNumber || 1;
        setSelectedSeason(nextSeason);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load anime');
      } finally {
        setLoading(false);
      }
    }

    void loadDetails();
  }, [id, requestedSeason, router]);

  useEffect(() => {
    if (!id || !selectedSeason) return;

    async function loadSeason() {
      try {
        const res = await fetch(`${API_URL}/anime/${id}/season/${selectedSeason}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Unable to load episodes');

        setEpisodes(data.episodes || []);
        setSelectedEpisode((data.episodes || [])[0] || null);
        setSources([]);
        setStreams([]);
        setActiveStream(null);
        setPlayerOpen(false);
        setPreloadedStreams({});
        episodeSourcePrefetchRef.current.clear();
        setVisibleSourceLimit(SOURCE_BATCH_SIZE);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load episodes');
      }
    }

    void loadSeason();
  }, [id, selectedSeason]);

  async function warmPlaybackAssets(stream: Stream) {
    const playbackId = getPlaybackId(stream.playbackUrl || stream.directUrl);
    if (!playbackId || warmedPlaybackIdsRef.current.has(playbackId)) return;

    warmedPlaybackIdsRef.current.add(playbackId);

    try {
      const response = await fetch(`${API_URL}/streams/play/${playbackId}/media-info`);
      if (!response.ok) throw new Error('Unable to warm media info');
    } catch {
      warmedPlaybackIdsRef.current.delete(playbackId);
    }
  }

  function buildAutoResolvePayload(episode: Episode) {
    if (!anime) return null;
    const previousEpisodeCount = usableSeasons
      .filter((season) => (season.seasonNumber || 0) > 0 && (season.seasonNumber || 0) < episode.seasonNumber)
      .reduce((total, season) => total + (season.episodeCount || 0), 0);
    const alternateEpisodeNumber = previousEpisodeCount > 0
      ? previousEpisodeCount + episode.episodeNumber
      : undefined;

    return {
      animeTitle: anime.title,
      originalTitle: anime.originalTitle,
      imdbId: anime.imdbId,
      episodeNumber: episode.episodeNumber,
      alternateEpisodeNumber,
      seasonNumber: episode.seasonNumber,
      token
    };
  }

  async function startPlayback(stream: Stream, episode: Episode) {
    if (!anime) return;
    const playbackUrl = stream.playbackUrl || stream.directUrl || '';
    const directUrl = stream.directUrl || stream.playbackUrl || '';
    if (!playbackUrl && !directUrl) return;

    setActiveStream(stream);
    await Promise.race([
      warmPlaybackAssets(stream),
      new Promise((resolve) => window.setTimeout(resolve, 900))
    ]);

    const payload = {
      url: directUrl,
      playbackUrl,
      title: anime.title,
      episodeTitle: episode.title,
      subtitleUrl: stream.subtitles?.[0],
      subtitles: stream.subtitles || [],
      embeddedSubtitlesLikely: stream.embeddedSubtitlesLikely,
      embeddedAudioTracksLikely: stream.embeddedAudioTracksLikely,
      returnTo: `/anime/${anime.id}`,
      playbackMode: 'subbed' as const,
      showId: anime.id,
      showTitle: anime.title,
      posterUrl: anime.posterUrl,
      backdropUrl: anime.backdropUrl,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      stillUrl: episode.stillUrl,
      runtime: episode.runtime,
      resumeTime,
      nextAirDate: nextEpisode?.airDate
    };

    if (typeof window !== 'undefined' && window.desktopPlayer) {
      const result = await window.desktopPlayer.play(payload);
      if (!result.ok) {
        setError(result.error || 'Unable to start app player');
        setPlayerOpen(true);
      }
      return;
    }

    setPlayerOpen(true);
  }

  async function autoResolve(episode: Episode, options: { startPlayer?: boolean } = {}) {
    if (!anime) return;

    setSelectedEpisode(episode);
    setResolvingEpisodeId(episode.id);
    setError('');
    setSources([]);
    setStreams([]);
    setActiveStream(null);
    setPlayerOpen(false);
    setSelectedSourceMagnet(null);
    setPreloadedStreams({});
    setVisibleSourceLimit(SOURCE_BATCH_SIZE);

    if (!isEpisodeReleased(episode)) {
      setResolvingEpisodeId(null);
      setError(`Episode ${episode.episodeNumber} releases ${formatAirDate(episode.airDate)}.`);
      return;
    }

    try {
      const payload = buildAutoResolvePayload(episode);
      if (!payload) return;

      const res = await fetch(`${API_URL}/streams/auto-resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      const stream = data.stream || data.streams?.[0] || null;
      setSources(data.sources || []);
      setStreams(data.streams || []);
      setActiveStream(stream);
      setSelectedSourceMagnet(data.selectedMagnet || null);

      if (stream && options.startPlayer) {
        await startPlayback(stream, episode);
      } else {
        const firstCached = (data.sources || []).find((source: Source) => source.cached === true);
        if (firstCached && options.startPlayer) {
          await resolveSource(firstCached, episode);
        }
      }

      if (!res.ok) throw new Error(data.error || 'Unable to resolve episode');
      if (data.error) setError(data.error);
      else if (!data.stream && !(data.sources || []).some((source: Source) => source.cached === true)) {
        setError('No cached RealDebrid source found for this episode yet.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resolve episode');
    } finally {
      setResolvingEpisodeId(null);
    }
  }

  async function resolveSource(source: Source, episodeOverride?: Episode) {
    const episode = episodeOverride || selectedEpisode;
    if (!episode || source.cached === false) return;

    setResolvingSourceMagnet(source.magnet);
    setSelectedSourceMagnet(source.magnet);
    setError('');

    const preloaded = preloadedStreams[source.magnet];
    if (preloaded?.length) {
      setStreams(preloaded);
      setResolvingSourceMagnet(null);
      await startPlayback(preloaded[0], episode);
      return;
    }

    setStreams([]);
    setActiveStream(null);

    try {
      const res = await fetch(`${API_URL}/streams/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          source: source.magnet,
          token,
          onlyCached: true,
          episodeNumber: episode.episodeNumber,
          seasonNumber: episode.seasonNumber
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unable to resolve selected source');

      setStreams(data.streams || []);
      const stream = data.streams?.[0] || null;
      if (stream) {
        await startPlayback(stream, episode);
      } else {
        setError('This cached source did not return a playable RealDebrid stream.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resolve selected source');
    } finally {
      setResolvingSourceMagnet(null);
    }
  }

  function toggleSaved() {
    if (!anime) return;

    if (saved) {
      removeShow(anime.id);
      setSaved(false);
      return;
    }

    saveShow({
      id: anime.id,
      title: anime.title,
      originalTitle: anime.originalTitle,
      overview: anime.overview,
      posterUrl: anime.posterUrl,
      backdropUrl: anime.backdropUrl,
      firstAirDate: anime.firstAirDate,
      voteAverage: anime.voteAverage
    });
    setSaved(true);
  }

  useEffect(() => {
    setVisibleSourceLimit(SOURCE_BATCH_SIZE);
  }, [selectedEpisode?.id]);

  useEffect(() => {
    if (!sourceLoadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleSourceLimit((limit) => Math.min(limit + SOURCE_BATCH_SIZE, visibleSources.length));
      },
      { root: sourceListRef.current, rootMargin: '80px' }
    );

    observer.observe(sourceLoadMoreRef.current);
    return () => observer.disconnect();
  }, [visibleSources.length]);

  useEffect(() => {
    if (!anime || episodes.length === 0) return;

    const requestedEpisode =
      requestedEpisodeNumber !== null
        ? episodes.find((episode) => episode.episodeNumber === requestedEpisodeNumber) || null
        : null;
    const targetEpisode = requestedEpisode || episodes[0];
    const key = `${anime.id}:${targetEpisode.seasonNumber}:${targetEpisode.id}`;
    if (autoResolvedEpisodeKey.current === key) return;

    autoResolvedEpisodeKey.current = key;
    const shouldStartPlayer = autoplayRequested && autoplayConsumedRef.current !== key;
    if (shouldStartPlayer) {
      autoplayConsumedRef.current = key;
    }

    void autoResolve(targetEpisode, { startPlayer: shouldStartPlayer });
  }, [anime, autoplayRequested, episodes, requestedEpisodeNumber]);

  useEffect(() => {
    if (
      !anime ||
      !selectedEpisode ||
      episodes.length === 0 ||
      resolvingEpisodeId !== null ||
      sources.length === 0 ||
      !isEpisodeReleased(selectedEpisode)
    ) return;

    const nextReleasedEpisodes = episodes
      .filter(
        (episode) =>
          episode.seasonNumber === selectedEpisode.seasonNumber &&
          episode.episodeNumber > selectedEpisode.episodeNumber &&
          isEpisodeReleased(episode)
      )
      .slice(0, 2);

    if (nextReleasedEpisodes.length === 0) return;

    const timeout = window.setTimeout(() => {
      for (const episode of nextReleasedEpisodes) {
        const key = `${anime.id}:${episode.seasonNumber}:${episode.episodeNumber}:${token ? 'rd' : 'guest'}`;
        if (episodeSourcePrefetchRef.current.has(key)) {
          continue;
        }

        const payload = buildAutoResolvePayload(episode);
        if (!payload) {
          continue;
        }

        episodeSourcePrefetchRef.current.add(key);
        void fetch(`${API_URL}/streams/auto-resolve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify(payload)
        }).catch(() => {
          episodeSourcePrefetchRef.current.delete(key);
        });
      }
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [anime, episodes, resolvingEpisodeId, selectedEpisode, sources.length, token]);

  useEffect(() => {
    if (!selectedEpisode || visibleSources.length === 0) return;

    const episodeKey = `${selectedEpisode.seasonNumber}:${selectedEpisode.episodeNumber}:${selectedEpisode.id}`;
    if (preloadEpisodeKeyRef.current === episodeKey) return;
    preloadEpisodeKeyRef.current = episodeKey;

    const preloadTargets = visibleSources
      .filter((source) => source.cached !== false)
      .slice(0, 6);

    if (preloadTargets.length === 0) return;

    void Promise.all(
      preloadTargets.map(async (source) => {
        if (preloadedStreams[source.magnet]?.length) {
          return;
        }

        try {
          const res = await fetch(`${API_URL}/streams/resolve`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
              source: source.magnet,
              token,
              onlyCached: true,
              episodeNumber: selectedEpisode.episodeNumber,
              seasonNumber: selectedEpisode.seasonNumber
            })
          });
          const data = await res.json();
          if (!res.ok || !Array.isArray(data.streams) || data.streams.length === 0) {
            return;
          }

          setPreloadedStreams((current) => {
            const latestEpisodeKey = `${selectedEpisode.seasonNumber}:${selectedEpisode.episodeNumber}:${selectedEpisode.id}`;
            if (preloadEpisodeKeyRef.current !== latestEpisodeKey || current[source.magnet]) {
              return current;
            }

            return {
              ...current,
              [source.magnet]: data.streams
            };
          });
          setSources((current) =>
            current.map((item) =>
              item.magnet === source.magnet && item.cached !== true
                ? { ...item, cached: true }
                : item
            )
          );

          void warmPlaybackAssets(data.streams[0]);
        } catch {
          return;
        }
      })
    );
  }, [preloadedStreams, selectedEpisode, token, visibleSources]);

  if (loading && !anime) return <div className="emptyState"><h1>Loading...</h1></div>;

  if (anime && activeStream && playerOpen) {
    return (
      <section className="cinemaPlayer">
        <VideoPlayer
          {...activeStream}
          showId={anime.id}
          showTitle={anime.title}
          posterUrl={anime.posterUrl}
          backdropUrl={anime.backdropUrl}
          title={anime.title}
          originalTitle={anime.originalTitle}
          imdbId={anime.imdbId}
          seasonNumber={selectedEpisode?.seasonNumber}
          episodeNumber={selectedEpisode?.episodeNumber}
          episodeTitle={selectedEpisode?.title}
          stillUrl={selectedEpisode?.stillUrl}
          runtime={selectedEpisode?.runtime}
          nextAirDate={nextEpisode?.airDate}
          resumeTime={resumeTime}
          onBack={() => setPlayerOpen(false)}
        />
      </section>
    );
  }

  return (
    <>
      {error && <div className="notice">{error}</div>}

      {!anime && error && (
        <div className="emptyState">
          <h1>Could not load this title</h1>
          <p>{error}</p>
        </div>
      )}

      {anime && (
        <section
          className="stremioDetail"
          style={{ ['--detail-backdrop' as string]: anime.backdropUrl ? `url(${anime.backdropUrl})` : 'none' }}
        >
          <div className="detailBackdropLayer" aria-hidden="true" />

          <button type="button" className="detailBack" onClick={() => void router.push('/')} title="Back">
            <ChevronLeft size={24} />
          </button>

          <div className="detailInfo">
            <div className="detailTitleBlock">
              <h1>{anime.title}</h1>
              <div className="heroFacts">
                {selectedEpisode?.runtime && <span>{selectedEpisode.runtime} min</span>}
                {anime.firstAirDate && <span>{anime.firstAirDate.slice(0, 4)}</span>}
                {anime.voteAverage !== undefined && <span>{anime.voteAverage.toFixed(1)} IMDb</span>}
                <span>{status === 'connected' ? 'RD Connected' : 'Connect RealDebrid'}</span>
              </div>
            </div>

            <div className="genreBubbles">
              <span>Anime</span>
              <span>Series</span>
              {anime.status && <span>{anime.status}</span>}
            </div>

            <div className="castBubbles">
              {usableSeasons.slice(0, 3).map((season) => (
                <span key={season.seasonNumber}>{season.title || `Season ${season.seasonNumber}`}</span>
              ))}
            </div>

            <div className="detailSummary">
              <p>{selectedEpisode?.overview || anime.overview || anime.originalTitle}</p>
            </div>

            <div className="heroActions">
              <button type="button" className="circleAction wide" title="Trailer">
                <PlayCircle size={18} />
                <span>Trailer</span>
              </button>
              <button type="button" className="circleAction libraryAction" onClick={toggleSaved} title={saved ? 'Remove from library' : 'Add to library'}>
                {saved ? <BookmarkCheck size={18} /> : <BookmarkPlus size={18} />}
                <span>{saved ? 'In Library' : 'Add to Library'}</span>
              </button>
            </div>
          </div>

          <aside className="sourcesOverlay">
            <div className="sourcePanelTop">
              <button type="button" className="panelBack" onClick={() => void router.push('/')} title="Back">
                <ChevronLeft size={20} />
              </button>
              <div>
                <strong>{anime.title}</strong>
                <span>{selectedEpisode ? `Episode ${selectedEpisode.episodeNumber}` : 'Select episode'}</span>
              </div>
              <select
                value={selectedSeason}
                onChange={(event) => setSelectedSeason(Number(event.target.value))}
                aria-label="Season"
              >
                {usableSeasons.map((season) => (
                  <option key={season.seasonNumber} value={season.seasonNumber}>
                    Season {season.seasonNumber}
                  </option>
                ))}
              </select>
            </div>

            <select
              className="episodeSelect"
              value={selectedEpisode?.id || ''}
              onChange={(event) => {
                const episode = episodes.find((item) => item.id === Number(event.target.value));
                if (episode) void autoResolve(episode);
              }}
              aria-label="Episode"
            >
              {episodes.map((episode) => (
                <option key={episode.id} value={episode.id} disabled={!isEpisodeReleased(episode)}>
                  S{episode.seasonNumber}E{episode.episodeNumber} - {episode.title}
                  {episode.airDate ? ` - ${isEpisodeReleased(episode) ? 'Released' : 'Releases'} ${formatAirDate(episode.airDate)}` : ''}
                </option>
              ))}
            </select>

            {selectedEpisode?.airDate && (
              <div className={isEpisodeReleased(selectedEpisode) ? 'episodeAirDate' : 'episodeAirDate unreleased'}>
                <span>{isEpisodeReleased(selectedEpisode) ? 'Released' : 'Not released yet'}</span>
                <strong>{formatAirDate(selectedEpisode.airDate)}</strong>
              </div>
            )}

            {resolvingEpisodeId && (
              <div className="sourceLoading">
                <span className="loadingDot" /> <span className="loadingDot" /> <span className="loadingDot" />
                <p>Finding cached sources...</p>
              </div>
            )}

            {visibleSources.length === 0 ? (
              <p className="sourceEmpty">No sources loaded yet.</p>
            ) : (
              <div className="sourceList stremioSources" ref={sourceListRef}>
                {shownSources.map((source) => (
                  <button
                    key={source.magnet}
                    className={selectedSourceMagnet === source.magnet ? 'sourceItem active' : 'sourceItem'}
                    disabled={source.cached === false || resolvingSourceMagnet !== null}
                    onClick={() => void resolveSource(source)}
                    title={source.cached === true ? 'Play cached source' : 'Source cache status unavailable'}
                  >
                    <div className="sourceProvider">
                      <span>[RD]</span>
                      <span>{source.source}</span>
                      <span>{source.quality || 'Unknown'}</span>
                    </div>
                    <div className="sourceItemMain">
                      <div className="sourceItemTitle">{source.title}</div>
                      <div className="sourceItemMeta">
                        {source.audio && <span>{source.audio}</span>}
                        {source.size && <span>{source.size}</span>}
                        <span>{source.seeders} seeds</span>
                        <span>{source.cached === true ? 'Cached' : source.cached === false ? 'Not cached' : 'Unknown'}</span>
                      </div>
                    </div>
                  </button>
                ))}
                {hasMoreSources && <div ref={sourceLoadMoreRef} className="sourceLoadMore">Loading more sources...</div>}
              </div>
            )}
          </aside>
        </section>
      )}
    </>
  );
}
