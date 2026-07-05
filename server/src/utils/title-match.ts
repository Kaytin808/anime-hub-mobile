const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'anime',
  'dub',
  'english',
  'episode',
  'film',
  'movie',
  'no',
  'of',
  'ona',
  'ova',
  'part',
  'season',
  'special',
  'sub',
  'subbed',
  'the',
  'to',
  'tv',
  'vs'
]);

const normalizeForMatch = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toCompact = (value: string) => normalizeForMatch(value).replace(/\s+/g, '');

const toTokens = (value: string) =>
  normalizeForMatch(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));

const unique = <T,>(values: T[]) => [...new Set(values)];

const hasToken = (haystack: Set<string>, needle: string) => haystack.has(needle);

export const scoreTitleRelevance = (candidate: string, titles: string[]) => {
  const normalizedCandidate = normalizeForMatch(candidate);
  const compactCandidate = toCompact(candidate);

  if (!normalizedCandidate) {
    return 0;
  }

  const candidateTokens = new Set(toTokens(candidate));
  let bestScore = 0;

  for (const title of unique(titles.filter(Boolean))) {
    const normalizedTitle = normalizeForMatch(title);
    const compactTitle = toCompact(title);
    const titleTokens = unique(toTokens(title));

    if (!normalizedTitle || titleTokens.length === 0) {
      continue;
    }

    let score = 0;

    if (normalizedCandidate.includes(normalizedTitle)) {
      score += 12;
    }

    if (compactTitle && compactCandidate.includes(compactTitle)) {
      score += 8;
    }

    let matchedTokens = 0;
    for (const token of titleTokens) {
      if (hasToken(candidateTokens, token)) {
        matchedTokens += 1;
      }
    }

    score += matchedTokens * 3;

    if (matchedTokens === titleTokens.length) {
      score += 6;
    } else if (matchedTokens >= Math.max(2, Math.ceil(titleTokens.length * 0.6))) {
      score += 3;
    }

    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
};

export const isRelevantTitleMatch = (
  candidate: string,
  titles: string[],
  minimumScore = 6
) => scoreTitleRelevance(candidate, titles) >= minimumScore;
