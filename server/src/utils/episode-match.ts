export type EpisodeMatchOptions = {
  episodeNumber?: number;
  seasonNumber?: number;
};

export const matchesEpisode = (
  filename: string,
  episodeNumber: number,
  seasonNumber?: number
): boolean => {
  const lower = filename.toLowerCase();
  const ep2 = String(episodeNumber).padStart(2, '0');
  const ep = String(episodeNumber);

  if (seasonNumber && seasonNumber > 0) {
    const s2 = String(seasonNumber).padStart(2, '0');
    if (new RegExp(`s${s2}[\\s._-]*e${ep2}\\b`, 'i').test(lower)) return true;
    if (new RegExp(`\\b${s2}x${ep2}\\b`, 'i').test(lower)) return true;
  }

  if (new RegExp(`\\be${ep2}\\b`, 'i').test(lower)) return true;
  if (new RegExp(`\\bep${ep2}\\b`, 'i').test(lower)) return true;
  if (new RegExp(`episode[\\s._-]*0*${ep}\\b`, 'i').test(lower)) return true;
  if (new RegExp(`[\\s\\[\\(-_]0*${ep}[\\s\\]\\)_\\-.]`, 'i').test(lower)) return true;

  return false;
};

export const scoreEpisodeMatch = (
  filename: string,
  episodeNumber: number,
  seasonNumber?: number
): number => {
  if (!matchesEpisode(filename, episodeNumber, seasonNumber)) {
    return 0;
  }

  let score = 10;
  const lower = filename.toLowerCase();
  const ep2 = String(episodeNumber).padStart(2, '0');

  if (seasonNumber && seasonNumber > 0) {
    const s2 = String(seasonNumber).padStart(2, '0');
    if (new RegExp(`s${s2}e${ep2}`, 'i').test(lower)) score += 5;
  }
  if (new RegExp(`\\be${ep2}\\b`, 'i').test(lower)) score += 3;
  if (new RegExp(`\\bep${ep2}\\b`, 'i').test(lower)) score += 2;

  return score;
};
