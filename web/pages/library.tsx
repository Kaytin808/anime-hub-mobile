import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readLibrary, removeShow, type SavedShow } from '../utils/library';

export default function LibraryPage() {
  const [shows, setShows] = useState<SavedShow[]>([]);

  useEffect(() => {
    setShows(readLibrary());
  }, []);

  if (shows.length === 0) {
    return (
      <section className="emptyState">
        <h1>Library</h1>
        <p>Save shows from a detail page and they will appear here.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="sectionHeader">
        <h2>Library</h2>
        <span className="badge">{shows.length} saved</span>
      </div>
      <div className="gridCards">
        {shows.map((show) => (
          <div key={show.id} className="libraryCard">
            <Link className="animeCard" href={`/anime/${show.id}`}>
              <div className="poster">
                {show.posterUrl ? (
                  <img src={show.posterUrl} alt="" loading="lazy" decoding="async" />
                ) : (
                  <div className="fallback">{show.title}</div>
                )}
              </div>
              <div className="meta">
                <h3>{show.title}</h3>
                <div className="facts">
                  {show.firstAirDate && <span>{show.firstAirDate.slice(0, 4)}</span>}
                  {show.voteAverage !== undefined && <span>Rating {show.voteAverage.toFixed(1)}</span>}
                </div>
                <p>{show.overview || show.originalTitle || 'No summary available.'}</p>
              </div>
            </Link>
            <button
              type="button"
              className="libraryRemove"
              onClick={() => {
                removeShow(show.id);
                setShows(readLibrary());
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
