export type SavedShow = {
  id: number;
  title: string;
  originalTitle?: string;
  overview: string;
  posterUrl?: string;
  backdropUrl?: string;
  firstAirDate?: string;
  voteAverage?: number;
};

const LIBRARY_KEY = 'anime_hub_library';

export const readLibrary = (): SavedShow[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const isSavedShow = (id: number) =>
  readLibrary().some((show) => show.id === id);

export const saveShow = (show: SavedShow) => {
  const existing = readLibrary().filter((item) => item.id !== show.id);
  localStorage.setItem(LIBRARY_KEY, JSON.stringify([show, ...existing]));
};

export const removeShow = (id: number) => {
  localStorage.setItem(
    LIBRARY_KEY,
    JSON.stringify(readLibrary().filter((show) => show.id !== id))
  );
};
