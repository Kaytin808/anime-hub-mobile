import crypto from 'crypto';

const SOURCE_TTL_MS = 15 * 60 * 1000;
const sourceLinks = new Map<string, { url: string; expiresAt: number }>();

export const registerSourceLink = (url: string) => {
  const id = `source:${crypto.createHash('sha256').update(url).digest('hex').slice(0, 24)}`;
  sourceLinks.set(id, {
    url,
    expiresAt: Date.now() + SOURCE_TTL_MS
  });
  return id;
};

export const resolveSourceLink = (source: string) => {
  if (!source.startsWith('source:')) {
    return source;
  }

  const entry = sourceLinks.get(source);
  if (!entry || entry.expiresAt < Date.now()) {
    sourceLinks.delete(source);
    return source;
  }

  return entry.url;
};
