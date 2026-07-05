import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type AnimeSummary = {
  id: number;
  title: string;
  overview: string;
  posterUrl?: string;
  firstAirDate?: string;
  voteAverage?: number;
};

export default function SearchPage() {
  const router = useRouter();
  const [results, setResults] = useState<AnimeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const query = Array.isArray(router.query.q) ? router.query.q[0] : router.query.q || '';

  useEffect(() => {
    const trimmed = query.trim();
    if (!router.isReady || !trimmed) {
      setResults([]);
      setError('');
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function runSearch() {
      setLoading(true);
      setError('');

      try {
        const res = await fetch(`${API_URL}/anime/search?q=${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        if (!cancelled) setResults(data.results || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void runSearch();

    return () => {
      cancelled = true;
    };
  }, [query, router.isReady]);

  return (
    <>
      <div className="searchTopbar">
        <h1 className="pageTitle" style={{ marginBottom: 0 }}>{query ? `Search: ${query}` : 'Search'}</h1>
      </div>

      {error && <div className="notice">{error}</div>}

      {!query && (
        <p style={{ color: '#8a95a8', fontSize: 14 }}>
          Use the search bar at the top to find anime.
        </p>
      )}

      {loading && (
        <p style={{ color: '#8a95a8', fontSize: 14 }}>Searching...</p>
      )}

      {query && results.length === 0 && !loading && (
        <p style={{ color: '#8a95a8', fontSize: 14 }}>No results found for &ldquo;{query}&rdquo;.</p>
      )}

      <div className="gridCards">
        {results.map((anime) => (
          <Link className="animeCard" key={anime.id} href={`/anime/${anime.id}`}>
            <div className="poster">
              {anime.posterUrl ? (
                <img src={anime.posterUrl} alt="" loading="lazy" decoding="async" />
              ) : (
                <div className="fallback">{anime.title}</div>
              )}
            </div>
            <div className="meta">
              <h3>{anime.title}</h3>
              <div className="facts">
                {anime.firstAirDate && <span>{anime.firstAirDate.slice(0, 4)}</span>}
                {anime.voteAverage !== undefined && (
                  <span>Rating {anime.voteAverage.toFixed(1)}</span>
                )}
              </div>
              <p>{anime.overview || 'No summary available.'}</p>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
