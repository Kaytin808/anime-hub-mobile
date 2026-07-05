import { scoreEpisodeMatch } from '../utils/episode-match';
import { fetchWithTimeout, isAbortError } from '../utils/fetch-timeout';
import { normalizeInfoHash } from './torrents/infohash';

const REST_API_BASE = 'https://api.real-debrid.com/rest/1.0';
const OAUTH_API_BASE = 'https://api.real-debrid.com/oauth/v2';
const DEVICE_GRANT_TYPE = 'http://oauth.net/grant_type/device/1.0';

type JsonRecord = Record<string, unknown>;
type UserInfo = {
  id?: number;
  username?: string;
  email?: string;
  type?: string;
  points?: number;
};

export type DeviceAuthStart = {
  device_code: string;
  user_code: string;
  verification_url: string;
  direct_verification_url?: string;
  expires_in: number;
  interval?: number;
};

export type DeviceAuthToken = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
};

export type ResolveOptions = {
  onlyCached?: boolean;
  episodeNumber?: number;
  seasonNumber?: number;
};

type WaitForDownloadsOptions = {
  attempts?: number;
  delayMs?: number;
};

export type ResolvedStream = {
  provider: 'realdebrid' | 'demo';
  sourceType: 'hoster' | 'magnet' | 'demo';
  id?: string;
  torrentId?: string;
  filename?: string;
  filesize?: number;
  quality?: string;
  container?: string;
  codec?: string;
  directUrl: string;
  playbackUrl?: string;
  expiresAt?: string;
  subtitles: string[];
  embeddedSubtitlesLikely?: boolean;
  embeddedAudioTracksLikely?: boolean;
};

class RealDebridError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'RealDebridError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

const getClientId = () => process.env.REALDEBRID_CLIENT_ID || 'X245A4XAIBGVM';
const getClientSecret = () => process.env.REALDEBRID_CLIENT_SECRET || '';
export const getToken = () => process.env.RD_USER_TOKEN || '';
const getUserToken = () => process.env.RD_USER_TOKEN || '';

const isMagnet = (source: string) => source.trim().toLowerCase().startsWith('magnet:');

const getMagnetHash = (magnet: string) => {
  const match = magnet.match(/btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/);
  return match?.[1] ? normalizeInfoHash(match[1]) : undefined;
};

const guessContainer = (filename = '') => {
  const match = filename.toLowerCase().match(/\.([a-z0-9]{2,5})(?:$|\?)/);
  return match?.[1];
};

const guessQuality = (value = '') => {
  const match = value.match(/\b(2160p|1440p|1080p|720p|480p|360p)\b/i);
  return match?.[1]?.toLowerCase();
};

const isVideoFile = (filename = '') =>
  /\.(mkv|mp4|webm|avi|mov|m4v)$/i.test(filename);

const hasEmbeddedSubtitleHint = (value = '') =>
  /\.(mkv)$/i.test(value) ||
  /\b(multi[\s-]?subs?|msubs?|subs?|softsubs?|ass|ssa|fansub)\b/i.test(value);

const hasEmbeddedAudioHint = (value = '') =>
  /\.(mkv)$/i.test(value) ||
  /\b(dual[\s-]?audio|multi[\s-]?audio|jpn|japanese|eng|english)\b/i.test(value);

const buildDemoStream = (): ResolvedStream[] => [
  {
    provider: 'demo',
    sourceType: 'demo',
    quality: '720p',
    container: 'mp4',
    codec: 'h264',
    directUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    subtitles: []
  }
];

class RealDebridService {
  async getUser(token?: string) {
    const authToken = token || getUserToken();
    if (!authToken) {
      throw new RealDebridError('RealDebrid token is not configured', 401);
    }

    return this.requestRest<UserInfo>('/user', { token: authToken });
  }

  async startDeviceAuth(): Promise<DeviceAuthStart> {
    const params = new URLSearchParams({
      client_id: getClientId(),
      new_credentials: 'yes'
    });

    return this.requestOAuth<DeviceAuthStart>(`/device/code?${params.toString()}`, {
      authRequired: false
    });
  }

  async pollDeviceAuth(deviceCode: string): Promise<DeviceAuthToken> {
    if (!deviceCode) {
      throw new RealDebridError('missing device_code', 400);
    }

    let clientId = getClientId();
    let clientSecret = getClientSecret();

    if (!clientSecret) {
      const credentialsParams = new URLSearchParams({
        client_id: clientId,
        code: deviceCode
      });

      const credentials = await this.requestOAuth<{ client_id: string; client_secret: string }>(
        `/device/credentials?${credentialsParams.toString()}`,
        { authRequired: false }
      );
      clientId = credentials.client_id;
      clientSecret = credentials.client_secret;
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: deviceCode,
      grant_type: DEVICE_GRANT_TYPE
    });

    return this.requestOAuth<DeviceAuthToken>('/token', {
      method: 'POST',
      authRequired: false,
      body
    });
  }

  async unrestrict(sourceUrl: string, token?: string, options: ResolveOptions = {}) {
    const authToken = token || getUserToken();

    if (!authToken) {
      return buildDemoStream();
    }

    if (isMagnet(sourceUrl)) {
      return this.resolveMagnet(sourceUrl, authToken, options);
    }

    const unrestricted = await this.requestRest<JsonRecord>('/unrestrict/link', {
      method: 'POST',
      token: authToken,
      body: new URLSearchParams({ link: sourceUrl })
    });

    return [this.mapUnrestrictedLink(unrestricted, 'hoster')];
  }

  private async resolveMagnet(
    magnet: string,
    token: string,
    options: ResolveOptions = {}
  ): Promise<ResolvedStream[]> {
    const onlyCached = options.onlyCached ?? true;
    const hash = getMagnetHash(magnet);
    let cachedFileIds: string[] = [];
    let probeViaResolver = false;

    if (hash) {
      try {
        cachedFileIds = await this.getCachedFileIds(hash, token);
      } catch (error) {
        if (
          onlyCached &&
          error instanceof RealDebridError &&
          /disabled_endpoint/i.test(error.message)
        ) {
          probeViaResolver = true;
        } else {
          throw error;
        }
      }
    }

    if (onlyCached && cachedFileIds.length === 0 && !probeViaResolver) {
      return [];
    }

    const added = await this.requestRest<{ id: string; uri?: string }>('/torrents/addMagnet', {
      method: 'POST',
      token,
      body: new URLSearchParams({ magnet })
    });

    const torrentId = added.id;
    const info = await this.requestRest<JsonRecord>(`/torrents/info/${torrentId}`, { token });
    const videoFileIds = this.getPreferredVideoFileIds(info, cachedFileIds, options);

    if (videoFileIds.length === 0) {
      await this.deleteTorrent(torrentId, token);
      throw new RealDebridError(
        options.episodeNumber
          ? 'no cached video file matched this episode in the torrent'
          : 'no playable video files found in torrent',
        422,
        info
      );
    }

    await this.requestRest<void>(`/torrents/selectFiles/${torrentId}`, {
      method: 'POST',
      token,
      body: new URLSearchParams({ files: videoFileIds.join(',') }),
      allowEmptyResponse: true,
      successStatuses: [200, 202, 204]
    });

    const selectedInfo = probeViaResolver && onlyCached
      ? await this.waitForCachedResolverProbe(torrentId, token)
      : await this.waitForTorrentDownloads(torrentId, token);
    const links = Array.isArray(selectedInfo.links) ? selectedInfo.links : [];

    const streams = await Promise.all(
      links.map((link) =>
        this.requestRest<JsonRecord>('/unrestrict/link', {
          method: 'POST',
          token,
          body: new URLSearchParams({ link: String(link) })
        }).then((unrestricted) => this.mapUnrestrictedLink(unrestricted, 'magnet', torrentId))
      )
    );

    const playable = streams.filter((stream) => Boolean(stream.directUrl));
    if (playable.length === 0) {
      await this.deleteTorrent(torrentId, token);
    }
    return this.sortStreamsForEpisode(playable, options);
  }

  private sortStreamsForEpisode(streams: ResolvedStream[], options: ResolveOptions) {
    if (!options.episodeNumber) {
      return streams;
    }

    return [...streams].sort((a, b) => {
      const scoreA = scoreEpisodeMatch(a.filename || '', options.episodeNumber!, options.seasonNumber);
      const scoreB = scoreEpisodeMatch(b.filename || '', options.episodeNumber!, options.seasonNumber);
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      return (b.filesize || 0) - (a.filesize || 0);
    });
  }

  private async waitForTorrentDownloads(
    torrentId: string,
    token: string,
    options: WaitForDownloadsOptions = {}
  ) {
    const maxAttempts = options.attempts ?? 5;
    const delayMs = options.delayMs ?? 700;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const info = await this.requestRest<JsonRecord>(`/torrents/info/${torrentId}`, { token });
      if (Array.isArray(info.links) && info.links.length > 0) {
        return info;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new RealDebridError('torrent was added but no RD download links were ready yet', 202);
  }

  private async waitForCachedResolverProbe(torrentId: string, token: string) {
    try {
      return await this.waitForTorrentDownloads(torrentId, token, {
        attempts: 6,
        delayMs: 1000
      });
    } catch (error) {
      await this.deleteTorrent(torrentId, token);
      return { links: [] } as JsonRecord;
    }
  }

  /**
   * Check whether a specific infoHash is already cached on RealDebrid.
   * Returns the infoHash if cached, null if not.
   */
  async checkCache(infoHash: string, token?: string): Promise<{ infoHash: string; cached: boolean; fileIds: string[] }> {
    const authToken = token || getUserToken();
    const normalizedHash = normalizeInfoHash(infoHash);
    if (!authToken || !normalizedHash) {
      return { infoHash: normalizedHash, cached: false, fileIds: [] };
    }

    const fileIds = await this.getCachedFileIds(normalizedHash, authToken);
    return { infoHash: normalizedHash, cached: fileIds.length > 0, fileIds };
  }

  async checkCaches(infoHashes: string[], token?: string) {
    const authToken = token || getUserToken();
    const uniqueHashes = [...new Set(infoHashes.map(normalizeInfoHash).filter(Boolean))];

    if (!authToken || uniqueHashes.length === 0) {
      return new Map<string, { infoHash: string; cached: boolean; fileIds: string[] }>();
    }

    const results = new Map<string, { infoHash: string; cached: boolean; fileIds: string[] }>();
    const chunkSize = 20;

    for (let index = 0; index < uniqueHashes.length; index += chunkSize) {
      const chunk = uniqueHashes.slice(index, index + chunkSize);
      const availability = await this.requestRest<JsonRecord>(
        `/torrents/instantAvailability/${chunk.join('/')}`,
        { token: authToken }
      );

      for (const hash of chunk) {
        const fileIds = this.extractCachedFileIdsForHash(availability, hash);
        results.set(hash, {
          infoHash: hash,
          cached: fileIds.length > 0,
          fileIds
        });
      }
    }

    return results;
  }

  private async getCachedFileIds(hash: string, token: string): Promise<string[]> {
    try {
      const checks = await this.checkCaches([hash], token);
      return checks.get(hash)?.fileIds || [];
    } catch (error) {
      if (error instanceof RealDebridError && error.statusCode === 404) {
        return [];
      }
      throw error;
    }
  }

  private extractCachedFileIds(value: unknown): string[] {
    const ids = new Set<string>();

    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') {
        return;
      }

      for (const [key, child] of Object.entries(node as JsonRecord)) {
        if (/^\d+$/.test(key) && child && typeof child === 'object') {
          const file = child as JsonRecord;
          if (typeof file.filename === 'string' && isVideoFile(file.filename)) {
            ids.add(key);
          }
        }
        visit(child);
      }
    };

    visit(value);
    return [...ids];
  }

  private extractCachedFileIdsForHash(value: unknown, hash: string) {
    if (!value || typeof value !== 'object') {
      return [];
    }

    const record = value as JsonRecord;
    const hashEntry = record[hash] ?? record[hash.toLowerCase()] ?? record[hash.toUpperCase()];
    return this.extractCachedFileIds(hashEntry);
  }

  private async deleteTorrent(torrentId: string, token: string) {
    if (!torrentId) {
      return;
    }

    try {
      await this.requestRest<void>(`/torrents/delete/${torrentId}`, {
        method: 'DELETE',
        token,
        allowEmptyResponse: true,
        successStatuses: [200, 202, 204]
      });
    } catch {
      // Best-effort cleanup only.
    }
  }

  private getPreferredVideoFileIds(
    info: JsonRecord,
    cachedFileIds: string[],
    options: ResolveOptions = {}
  ) {
    const cached = new Set(cachedFileIds);
    const files = Array.isArray(info.files) ? info.files : [];

    const eligible = files
      .filter((file): file is JsonRecord => Boolean(file && typeof file === 'object'))
      .map((file) => ({
        id: String(file.id ?? ''),
        path: String(file.path ?? file.filename ?? ''),
        bytes: Number(file.bytes ?? 0)
      }))
      .filter((file) => isVideoFile(file.path) && (cached.size === 0 || cached.has(file.id)));

    if (eligible.length === 0) {
      return [];
    }

    if (eligible.length === 1) {
      return [eligible[0].id];
    }

    if (options.episodeNumber) {
      const scored = eligible
        .map((file) => ({
          ...file,
          score: scoreEpisodeMatch(file.path, options.episodeNumber!, options.seasonNumber)
        }))
        .filter((file) => file.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          return b.bytes - a.bytes;
        });

      if (scored.length > 0) {
        return [scored[0].id];
      }
    }

    return eligible.sort((a, b) => b.bytes - a.bytes).slice(0, 1).map((file) => file.id);
  }

  private mapUnrestrictedLink(
    data: JsonRecord,
    sourceType: 'hoster' | 'magnet',
    torrentId?: string
  ): ResolvedStream {
    const filename = String(data.filename ?? '');
    const directUrl = String(data.download ?? '');

    return {
      provider: 'realdebrid',
      sourceType,
      id: typeof data.id === 'string' ? data.id : undefined,
      torrentId,
      filename: filename || undefined,
      filesize: typeof data.filesize === 'number' ? data.filesize : undefined,
      quality: guessQuality(filename || String(data.type ?? '')),
      container: guessContainer(filename),
      directUrl,
      subtitles: [],
      embeddedSubtitlesLikely: hasEmbeddedSubtitleHint(filename),
      embeddedAudioTracksLikely: hasEmbeddedAudioHint(filename)
    };
  }

  private async requestRest<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      token?: string;
      body?: URLSearchParams;
      allowEmptyResponse?: boolean;
      successStatuses?: number[];
    } = {}
  ): Promise<T> {
    const token = options.token || getUserToken();
    if (!token) {
      throw new RealDebridError('RealDebrid token is not configured', 401);
    }

    return this.request<T>(`${REST_API_BASE}${path}`, {
      method: options.method,
      token,
      body: options.body,
      allowEmptyResponse: options.allowEmptyResponse,
      successStatuses: options.successStatuses
    });
  }

  private async requestOAuth<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      authRequired: false;
      body?: URLSearchParams;
    }
  ): Promise<T> {
    return this.request<T>(`${OAUTH_API_BASE}${path}`, {
      method: options.method,
      body: options.body
    });
  }

  private async request<T>(
    url: string,
    options: {
      method?: string;
      token?: string;
      body?: URLSearchParams;
      allowEmptyResponse?: boolean;
      successStatuses?: number[];
    } = {}
  ): Promise<T> {
    const method = options.method || 'GET';
    const headers: Record<string, string> = {};

    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    if (options.body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(url, {
        method,
        headers,
        body: options.body
      }, 12000);
    } catch (error) {
      throw new RealDebridError(
        isAbortError(error)
          ? 'RealDebrid took too long to respond. Try again in a moment.'
          : 'Unable to reach the RealDebrid API. Check your internet connection, VPN, DNS, or firewall settings.',
        503,
        error
      );
    }
    const successStatuses = options.successStatuses || [200, 201, 204];
    const text = await response.text();
    let data: unknown;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!successStatuses.includes(response.status)) {
      const message =
        data && typeof data === 'object' && 'error' in data
          ? String((data as JsonRecord).error)
          : typeof data === 'string' && data.trim()
          ? data.trim()
          : `RealDebrid request failed with HTTP ${response.status}`;
      throw new RealDebridError(message, response.status, data);
    }

    if (data === undefined && !options.allowEmptyResponse) {
      return undefined as T;
    }

    return data as T;
  }
}

export { RealDebridError };
export default new RealDebridService();
