const QUALITY_ORDER = [
  '2160p',
  '1440p',
  '1080p',
  '720p',
  '576p',
  '480p',
  '360p',
  '240p',
  '144p',
  'unknown'
];

export const inferAudioLabel = (value: string) => {
  const lower = value.toLowerCase();

  if (
    /\b(dual[\s-]?audio|multi[\s-]?audio|eng\/jpn|jpn\/eng|english\s*\+\s*japanese)\b/.test(lower)
  ) {
    return 'Dual audio';
  }

  if (
    /\b(eng dub|english dub|dubbed|uncensored dub|multi english)\b/.test(lower) ||
    /\b(eng)\b/.test(lower) && /\b(dub|dubbed)\b/.test(lower)
  ) {
    return 'Eng dub';
  }

  if (
    /\b(sub|subbed|softsub|softsubs|english[\s-]?subs|eng[\s-]?sub|eng[\s-]?subs|multi[\s-]?subs)\b/.test(lower)
  ) {
    return 'Subbed';
  }

  return 'Unknown audio';
};

export const audioRank = (label?: string) => {
  switch (label) {
    case 'Dual audio':
      return 3;
    case 'Subbed':
      return 2;
    case 'Eng dub':
      return 1;
    default:
      return 0;
  }
};

export const releaseGroupRank = (title: string) => {
  const lower = title.toLowerCase();

  if (/\b(toonshub|varyg|yameii)\b/.test(lower)) {
    return 6;
  }
  if (/\b(lbe3l|vlbe3l|kitsune|subsplease|ember|judas|nanakoraws|nanako raws)\b/.test(lower)) {
    return 4;
  }
  if (/\b(cr|crunchyroll|web-dl|webrip)\b/.test(lower)) {
    return 2;
  }
  return 0;
};

export const qualityRank = (quality?: string) => {
  const index = quality ? QUALITY_ORDER.indexOf(quality) : QUALITY_ORDER.indexOf('unknown');
  return index === -1 ? -1 : QUALITY_ORDER.length - index;
};

export const sortSourcesForUi = <
  T extends {
    cached?: boolean | null;
    quality?: string;
    seeders: number;
    title: string;
    audio?: string;
  }
>(
  sources: T[]
) =>
  [...sources].sort((a, b) => {
    const cacheRank = (value?: boolean | null) => {
      if (value === true) return 2;
      if (value === null || value === undefined) return 1;
      return 0;
    };

    const cacheDelta = cacheRank(b.cached) - cacheRank(a.cached);
    if (cacheDelta !== 0) {
      return cacheDelta;
    }

    const audioDelta = audioRank(b.audio) - audioRank(a.audio);
    if (audioDelta !== 0) {
      return audioDelta;
    }

    const releaseGroupDelta = releaseGroupRank(b.title) - releaseGroupRank(a.title);
    if (releaseGroupDelta !== 0) {
      return releaseGroupDelta;
    }

    const qualityDelta = qualityRank(b.quality) - qualityRank(a.quality);
    if (qualityDelta !== 0) {
      return qualityDelta;
    }

    if (b.seeders !== a.seeders) {
      return b.seeders - a.seeders;
    }

    return a.title.localeCompare(b.title);
  });
