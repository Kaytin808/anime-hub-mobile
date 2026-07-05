export type TorrentSource = 'nyaa' | 'animetosho' | 'torrentio' | 'comet' | 'otaku';

export type TorrentEntry = {
  title: string;
  magnet: string;
  infoHash: string;
  resolveUrl?: string;
  size: string;
  seeders: number;
  cached?: boolean | null;
  quality?: string;
  audio?: string;
  source: TorrentSource;
  fileIdx?: number;
  filename?: string;
};
