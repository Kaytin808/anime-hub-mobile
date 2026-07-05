export const buildPlaybackUrl = (playbackId: string, apiBase?: string) => {
  const base = (apiBase || process.env.PUBLIC_API_URL || '').replace(/\/$/, '');
  const path = `/streams/play/${playbackId}`;
  return base ? `${base}${path}` : path;
};
