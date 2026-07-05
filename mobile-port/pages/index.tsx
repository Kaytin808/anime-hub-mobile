import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type AnimeSummary = {
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

type HomePayload = {
  trendingNow: AnimeSummary[];
  popularThisSeason: AnimeSummary[];
  upcomingNextSeason: AnimeSummary[];
  meta?: {
    thisSeason?: string;
    nextSeason?: string;
  };
};

const emptyHomePayload: HomePayload = {
  trendingNow: [],
  popularThisSeason: [],
  upcomingNextSeason: [],
  meta: {}
};

export default function Home() {
  const [homeRows, setHomeRows] = useState<HomePayload>(emptyHomePayload);
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const heroItems = useMemo(
    () => homeRows.trendingNow.filter((anime) => anime.backdropUrl).slice(0, 5),
    [homeRows.trendingNow]
  );

  const allHomeAnime = useMemo(
    () => [...homeRows.trendingNow, ...homeRows.popularThisSeason, ...homeRows.upcomingNextSeason],
    [homeRows]
  );

  const hero = useMemo(
    () =>
      allHomeAnime.find((anime) => anime.id === highlightedId) ||
      allHomeAnime.find((anime) => anime.backdropUrl) ||
      allHomeAnime[0],
    [allHomeAnime, highlightedId]
  );

  const activeHeroIndex = useMemo(
    () => Math.max(0, heroItems.findIndex((anime) => anime.id === hero?.id)),
    [hero?.id, heroItems]
  );

  function cycleHero(direction: -1 | 1) {
    if (heroItems.length === 0) return;

    const nextIndex = (activeHeroIndex + direction + heroItems.length) % heroItems.length;
    setHighlightedId(heroItems[nextIndex]?.id || heroItems[0].id);
  }

  useEffect(() => {
    async function loadHome() {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/anime/home`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Unable to load anime home');

        const nextRows = {
          trendingNow: (data.trendingNow || []).slice(0, 18),
          popularThisSeason: (data.popularThisSeason || []).slice(0, 18),
          upcomingNextSeason: (data.upcomingNextSeason || []).slice(0, 18),
          meta: data.meta || {}
        };

        setHomeRows(nextRows);
        const heroCandidate =
          (nextRows.trendingNow || []).find((anime: AnimeSummary) => anime.backdropUrl) ||
          nextRows.trendingNow[0] ||
          nextRows.popularThisSeason[0] ||
          nextRows.upcomingNextSeason[0] ||
          null;
        setHighlightedId(heroCandidate?.id || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load anime');
      } finally {
        setLoading(false);
      }
    }

    void loadHome();
  }, []);

  useEffect(() => {
    if (heroItems.length <= 1) return;

    const timer = window.setInterval(() => {
      setHighlightedId((current) => {
        const currentIndex = Math.max(
          0,
          heroItems.findIndex((anime) => anime.id === current)
        );
        const nextIndex = (currentIndex + 1) % heroItems.length;
        return heroItems[nextIndex]?.id || heroItems[0]?.id || current;
      });
    }, 7000);

    return () => window.clearInterval(timer);
  }, [heroItems]);

  return (
    <main
      className="homeDashboard"
      style={{ ['--dynamic-backdrop' as string]: hero?.backdropUrl ? `url(${hero.backdropUrl})` : 'none' }}
    >
      {error && <div className="notice">{error}</div>}

      {hero && (
        <section className="spotlightHero">
          {hero.backdropUrl ? (
            <img
              className="spotlightHeroMedia"
              src={hero.backdropUrl}
              alt=""
              aria-hidden="true"
              decoding="async"
              fetchPriority="high"
            />
          ) : null}
          <div className="spotlightHeroShade" aria-hidden="true" />
          <div className="spotlightHeroGlow" aria-hidden="true" />
          <button
            type="button"
            className="spotlightHeroArrow spotlightHeroArrowLeft"
            onClick={() => cycleHero(-1)}
            title="Previous trending anime"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            className="spotlightHeroArrow spotlightHeroArrowRight"
            onClick={() => cycleHero(1)}
            title="Next trending anime"
          >
            <ChevronRight size={20} />
          </button>

          <div className="spotlightCopy">
            <div className="spotlightKicker">Trending Now</div>
            <h1>{hero.title}</h1>
            <div className="heroFacts">
              {hero.firstAirDate && <span>{hero.firstAirDate.slice(0, 4)}</span>}
              {hero.voteAverage !== undefined && <span>{hero.voteAverage.toFixed(1)} rating</span>}
              {hero.popularity !== undefined && <span>{Math.round(hero.popularity)} heat</span>}
            </div>
            <p>{hero.overview || hero.originalTitle}</p>
            <div className="spotlightActions">
              <Link className="heroButton sleek" href={`/anime/${hero.id}`}>
                <Play size={17} />
                <span>Open Show</span>
              </Link>
              <Link className="heroButton heroButtonSecondary" href={`/anime/${hero.id}`}>
                <span>More Info</span>
              </Link>
            </div>
          </div>

          <div className="spotlightIndicators" aria-label="Trending hero slides">
            <div className="spotlightIndicatorTrack">
              {heroItems.map((anime, index) => (
                <button
                  key={anime.id}
                  type="button"
                  className={index === activeHeroIndex ? 'spotlightIndicator active' : 'spotlightIndicator'}
                  onClick={() => setHighlightedId(anime.id)}
                  title={`Show ${anime.title}`}
                  aria-label={`Show ${anime.title}`}
                />
              ))}
            </div>
            <div className="spotlightIndicatorCount">
              <span>{String(activeHeroIndex + 1).padStart(2, '0')}</span>
              <span>/</span>
              <span>{String(heroItems.length || 1).padStart(2, '0')}</span>
            </div>
          </div>
        </section>
      )}

      <ContentRow
        title="Trending Now"
        badge={loading ? 'Loading' : `${homeRows.trendingNow.length} shows`}
        items={homeRows.trendingNow}
      />

      <ContentRow
        title="Popular This Season"
        badge={homeRows.meta?.thisSeason || 'Current season'}
        items={homeRows.popularThisSeason}
      />

      <ContentRow
        title="Upcoming Next Season"
        badge={homeRows.meta?.nextSeason || 'Next season'}
        items={homeRows.upcomingNextSeason}
      />
    </main>
  );
}

function ContentRow({
  title,
  badge,
  items
}: {
  title: string;
  badge: string;
  items: AnimeSummary[];
}) {
  const railRef = useRef<HTMLDivElement | null>(null);

  function scrollRail(direction: -1 | 1) {
    const rail = railRef.current;
    if (!rail) return;

    rail.scrollBy({
      left: direction * Math.max(rail.clientWidth * 0.86, 320),
      behavior: 'smooth'
    });
  }

  return (
    <section className="dashboardBand">
      <div className="sectionHeader railHeader">
        <div>
          <h2>{title}</h2>
          <span className="badge">{badge}</span>
        </div>
        <div className="railControls" aria-label={`${title} controls`}>
          <button type="button" onClick={() => scrollRail(-1)} title="Previous">
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => scrollRail(1)} title="Next">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="posterRail" ref={railRef}>
        {items.map((anime, index) => (
          <AnimeCard
            key={`${title}-${anime.id}`}
            anime={anime}
            rank={index + 1}
          />
        ))}
      </div>
    </section>
  );
}

function AnimeCard({
  anime,
  rank
}: {
  anime: AnimeSummary;
  rank: number;
}) {
  const priorityPoster = rank <= 6;

  return (
    <Link className="animeCard topAnimeCard" href={`/anime/${anime.id}`}>
      <div className="rankBadge">{rank}</div>
      <div className="poster">
        {anime.posterUrl ? (
          <img
            src={anime.posterUrl}
            alt=""
            loading={priorityPoster ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priorityPoster ? 'high' : 'auto'}
          />
        ) : (
          <div className="fallback">{anime.title}</div>
        )}
      </div>
      <div className="meta">
        <h3>{anime.title}</h3>
        <div className="facts">
          {anime.firstAirDate && <span>{anime.firstAirDate.slice(0, 4)}</span>}
          {anime.voteAverage !== undefined && <span>{anime.voteAverage.toFixed(1)}</span>}
        </div>
      </div>
    </Link>
  );
}
