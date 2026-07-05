import { randomBytes } from 'crypto';

type PlaybackEntry = {
  url: string;
  expiresAt: number;
};

const TTL_MS = 4 * 60 * 60 * 1000;
const entries = new Map<string, PlaybackEntry>();

const purgeExpired = () => {
  const now = Date.now();
  for (const [id, entry] of entries) {
    if (entry.expiresAt <= now) {
      entries.delete(id);
    }
  }
};

export const registerPlaybackUrl = (directUrl: string): string => {
  purgeExpired();
  const id = randomBytes(16).toString('hex');
  entries.set(id, {
    url: directUrl,
    expiresAt: Date.now() + TTL_MS
  });
  return id;
};

export const getPlaybackUrl = (id: string): string | null => {
  purgeExpired();
  const entry = entries.get(id);
  if (!entry || entry.expiresAt <= Date.now()) {
    entries.delete(id);
    return null;
  }
  return entry.url;
};
