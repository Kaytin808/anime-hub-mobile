export type WatchProgress = {
  key: string;
  showId: number;
  showTitle: string;
  posterUrl?: string;
  backdropUrl?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  stillUrl?: string;
  runtime?: number;
  currentTime: number;
  duration: number;
  updatedAt: number;
  nextAirDate?: string;
};

const STORAGE_KEY = 'anime-hub-watch-progress';
const MAX_ITEMS = 18;

const readRaw = (): WatchProgress[] => {
  if (typeof window === 'undefined') return [];
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeRaw = (items: WatchProgress[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
};

export const getWatchProgress = () =>
  readRaw().sort((a, b) => b.updatedAt - a.updatedAt);

export const saveWatchProgress = (progress: WatchProgress) => {
  const items = readRaw().filter((item) => item.key !== progress.key);
  writeRaw([
    {
      ...progress,
      updatedAt: Date.now()
    },
    ...items
  ]);
};

export const progressPercent = (item: Pick<WatchProgress, 'currentTime' | 'duration'>) => {
  if (!item.duration || item.duration <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((item.currentTime / item.duration) * 100)));
};

export const formatMinutes = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  return `${Math.round(seconds / 60)}m`;
};

export const countdownLabel = (date?: string) => {
  if (!date) return 'Date pending';
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return 'Date pending';

  const delta = target.getTime() - Date.now();
  if (delta <= 0) return 'Available now';

  const hours = Math.ceil(delta / 36e5);
  if (hours < 48) return `${hours}h`;

  return `${Math.ceil(hours / 24)}d`;
};
