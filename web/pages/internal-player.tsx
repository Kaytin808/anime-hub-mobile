import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Maximize2, Pause, Play, Subtitles, Volume2 } from 'lucide-react';
import { saveWatchProgress } from '../utils/watch-progress';

type PlayerPayload = {
  url: string;
  playbackUrl?: string;
  title?: string;
  subtitleUrl?: string;
  subtitles?: string[];
  returnTo?: string;
  playbackMode?: 'subbed' | 'dubbed';
  showId?: number;
  showTitle?: string;
  posterUrl?: string;
  backdropUrl?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  stillUrl?: string;
  runtime?: number;
  nextAirDate?: string;
  resumeTime?: number;
  playerBackend?: 'mpv' | 'html5';
  embeddedSubtitlesLikely?: boolean;
  embeddedAudioTracksLikely?: boolean;
};

type DesktopPlayerState = {
  currentTime?: number;
  duration?: number;
  paused?: boolean;
  subtitleVisible?: boolean;
  lastError?: string;
  timeLabel?: string;
  durationLabel?: string;
};

type EmbeddedAudioStream = {
  index: number;
  codecName?: string;
  language?: string;
  title?: string;
  channels?: number;
};

type EmbeddedSubtitleStream = {
  index: number;
  codecName?: string;
  language?: string;
  title?: string;
};

type MediaInfoResponse = {
  formatName?: string;
  duration?: number;
  audioTracks: EmbeddedAudioStream[];
  subtitleTracks: EmbeddedSubtitleStream[];
};

type HtmlAudioTrack = {
  id: number;
  label: string;
  language: string;
  enabled: boolean;
};

type HtmlSubtitleTrack = {
  id: string;
  label: string;
  language: string;
  mode: string;
  cues?: number;
};

type ExternalSubtitleTrack = {
  id: string;
  label: string;
  language: string;
  src: string;
  streamIndex?: number;
};

type ParsedSubtitleCue = {
  start: number;
  end: number;
  text: string;
};

const scoreAudioTrack = (track: Pick<HtmlAudioTrack, 'label' | 'language'>) => {
  const language = (track.language || '').toLowerCase();
  const label = (track.label || '').toLowerCase();

  if (/(^|[^a-z])(ja|jpn|japanese)($|[^a-z])/.test(language) || /japanese|original/.test(label)) return 0;
  if (/(^|[^a-z])(en|eng|english)($|[^a-z])/.test(language) || /english|dub/.test(label)) return 40;
  return 90;
};

const scoreSubtitleTrack = (track: Pick<HtmlSubtitleTrack, 'label' | 'language'>) => {
  const language = (track.language || '').toLowerCase();
  const label = (track.label || '').toLowerCase();

  let score = 100;
  if (/(^|[^a-z])(en|eng|english)($|[^a-z])/.test(language) || /english|full|dialogue|dialog/.test(label)) score = 0;
  else if (language && language !== 'und') score = 30;

  if (/sign/.test(label)) score += 220;
  if (/song/.test(label)) score += 50;
  if (/sdh|cc/.test(label)) score += 20;
  return score;
};

const normalizeLanguageLabel = (value?: string) => {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized || normalized === 'und') return '';
  if (['ja', 'jpn', 'jp'].includes(normalized)) return 'Japanese';
  if (['en', 'eng'].includes(normalized)) return 'English';
  return normalized.length <= 3 ? normalized.toUpperCase() : normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatEmbeddedAudioLabel = (track: EmbeddedAudioStream, fallbackIndex: number) => {
  const parts = [
    track.title?.trim(),
    normalizeLanguageLabel(track.language) || `Track ${fallbackIndex + 1}`,
    track.channels ? `${track.channels}ch` : '',
    track.codecName?.toUpperCase() || ''
  ].filter(Boolean);

  return parts.join(' • ');
};

const formatEmbeddedSubtitleLabel = (track: EmbeddedSubtitleStream, fallbackIndex: number) => {
  const parts = [
    track.title?.trim(),
    normalizeLanguageLabel(track.language) || `Subtitle ${fallbackIndex + 1}`,
    track.codecName?.toUpperCase() || ''
  ].filter(Boolean);

  return parts.join(' • ');
};

function readAudioTracks(video: HTMLVideoElement | null): HtmlAudioTrack[] {
  const list = (video as HTMLVideoElement & {
    audioTracks?: ArrayLike<{ label?: string; language?: string; enabled?: boolean }>;
  } | null)?.audioTracks;

  if (!list) return [];

  return Array.from({ length: list.length }, (_, index) => {
    const track = list[index];
    return {
      id: index,
      label: track?.label || track?.language || `Audio ${index + 1}`,
      language: track?.language || 'und',
      enabled: Boolean(track?.enabled)
    };
  });
}

function readSubtitleTracks(video: HTMLVideoElement | null): HtmlSubtitleTrack[] {
  if (!video) return [];

  return Array.from({ length: video.textTracks.length }, (_, index) => {
    const track = video.textTracks[index];
    return {
      id: `text-${index}`,
      label: track.label || track.language || `Subtitle ${index + 1}`,
      language: track.language || 'und',
      mode: track.mode,
      cues: track.cues?.length || 0
    };
  });
}

const decodePayload = (value: string): PlayerPayload | null => {
  try {
    const binary = window.atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    return parsed && typeof parsed.url === 'string' ? parsed : null;
  } catch {
    return null;
  }
};

const formatTime = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const parseSubtitleTimestamp = (value: string) => {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length !== 3) return null;

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds;
};

const parseSubtitleText = (rawText: string) => {
  const normalized = rawText.replace(/^\uFEFF/, '').replace(/\r+/g, '').trim();
  if (!normalized) return [] as ParsedSubtitleCue[];

  const body = normalized.startsWith('WEBVTT')
    ? normalized.replace(/^WEBVTT[^\n]*\n+/, '')
    : normalized;

  const blocks = body.split(/\n{2,}/);
  const cues: ParsedSubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const timingLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingLineIndex === -1) continue;

    const timingLine = lines[timingLineIndex];
    const [startText, endTextWithSettings] = timingLine.split('-->').map((part) => part.trim());
    const endText = endTextWithSettings.split(/\s+/)[0];
    const start = parseSubtitleTimestamp(startText);
    const end = parseSubtitleTimestamp(endText);
    if (start === null || end === null || end <= start) continue;

    const text = lines.slice(timingLineIndex + 1).join('\n').trim();
    if (!text) continue;

    cues.push({ start, end, text });
  }

  if (cues.length === 0 && /(^|\n)\[Events\]/i.test(normalized) && /(^|\n)Dialogue:/i.test(normalized)) {
    const assCues: ParsedSubtitleCue[] = [];
    for (const line of normalized.split('\n')) {
      const match = line.match(/^Dialogue:\s*\d*,([^,]+),([^,]+),[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(.*)$/i);
      if (!match) continue;

      const start = parseSubtitleTimestamp(match[1]);
      const end = parseSubtitleTimestamp(match[2]);
      if (start === null || end === null || end <= start) continue;

      const text = match[3]
        .replace(/\{[^}]+\}/g, '')
        .replace(/\\N/gi, '\n')
        .replace(/\\n/g, '\n')
        .trim();

      if (!text) continue;
      assCues.push({ start, end, text });
    }

    return assCues;
  }

  return cues;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const getPlaybackId = (url?: string) => {
  if (!url) return null;
  const match = url.match(/\/streams\/play\/([^/?]+)/);
  return match?.[1] || null;
};

export default function InternalPlayerPage() {
  const router = useRouter();
  const raw = Array.isArray(router.query.data) ? router.query.data[0] : router.query.data;
  const payload = useMemo(() => {
    if (!raw || typeof window === 'undefined') return null;
    return decodePayload(raw);
  }, [raw]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastProgressWriteRef = useRef(0);
  const resumeAppliedRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const audioSelectionTouchedRef = useRef(false);
  const audioAutoAppliedRef = useRef(false);
  const subtitleCueCacheRef = useRef<Map<string, ParsedSubtitleCue[]>>(new Map());

  const [mode, setMode] = useState<'mpv' | 'html5' | 'loading'>('loading');
  const [status, setStatus] = useState('Starting playback...');
  const [playing, setPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [desktopError, setDesktopError] = useState('');
  const [subtitleStatus, setSubtitleStatus] = useState('');
  const [audioTracks, setAudioTracks] = useState<HtmlAudioTrack[]>([]);
  const [subtitleTracksExposed, setSubtitleTracksExposed] = useState<HtmlSubtitleTrack[]>([]);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<number | null>(null);
  const [selectedSubtitleTrackId, setSelectedSubtitleTrackId] = useState<string>('off');
  const [embeddedMediaInfo, setEmbeddedMediaInfo] = useState<MediaInfoResponse | null>(null);
  const [playbackSrc, setPlaybackSrc] = useState('');
  const [manualSubtitleCues, setManualSubtitleCues] = useState<ParsedSubtitleCue[]>([]);
  const [playbackTimeOffset, setPlaybackTimeOffset] = useState(0);

  const streamSrc = payload?.playbackUrl || payload?.url || '';
  const playbackId = useMemo(() => getPlaybackId(payload?.playbackUrl), [payload?.playbackUrl]);
  const subtitleTracks = useMemo<ExternalSubtitleTrack[]>(() => {
    const urls = Array.isArray(payload?.subtitles)
      ? payload?.subtitles.filter((url): url is string => typeof url === 'string' && Boolean(url))
      : payload?.subtitleUrl
      ? [payload.subtitleUrl]
      : [];

    if (urls.length === 0 && playbackId && embeddedMediaInfo?.subtitleTracks?.length) {
      return embeddedMediaInfo.subtitleTracks.map((track, index) => ({
        id: `embedded-${track.index}`,
        label: `${formatEmbeddedSubtitleLabel(track, index)} (Extracted)`,
        language: track.language || 'en',
        src: `${API_URL}/streams/play/${playbackId}/subtitle/${track.index}`,
        streamIndex: track.index
      }));
    }

    return urls.map((url, index) => ({
      id: `sub-${index}`,
      label: index === 0 ? 'English subtitles' : `Subtitle ${index + 1}`,
      language: 'en',
      src: `${API_URL}/subtitles/track?url=${encodeURIComponent(url)}`
    }));
  }, [embeddedMediaInfo?.subtitleTracks, payload?.subtitleUrl, payload?.subtitles, playbackId]);
  const currentAudioRemuxTrackId = useMemo(() => {
    const match = playbackSrc.match(/\/audio\/(\d+)/);
    return match ? Number(match[1]) : null;
  }, [playbackSrc]);
  const isRemuxedPlayback = currentAudioRemuxTrackId !== null;
  const subtitleOptions = useMemo(() => {
    if (subtitleTracks.length > 0) {
      return subtitleTracks
        .slice()
        .sort((a, b) => scoreSubtitleTrack(a) - scoreSubtitleTrack(b))
        .map((track) => ({
          id: track.id,
          label: track.label,
          language: track.language
        }));
    }

    return subtitleTracksExposed
      .slice()
      .sort((a, b) => scoreSubtitleTrack(a) - scoreSubtitleTrack(b))
      .map((track) => ({
        id: track.id,
        label: track.label,
        language: track.language
      }));
  }, [subtitleTracks, subtitleTracksExposed]);
  const audioOptions = useMemo(() => {
    if (audioTracks.length > 0) {
      return audioTracks.map((track) => ({
        id: track.id,
        label: track.label,
        language: track.language
      }));
    }

    return (
      embeddedMediaInfo?.audioTracks.map((track) => ({
        id: track.index,
        label: formatEmbeddedAudioLabel(track, Math.max(0, track.index - 1)),
        language: track.language || 'und'
      })) || []
    );
  }, [audioTracks, embeddedMediaInfo?.audioTracks]);
  const authoritativeDuration = useMemo(() => {
    const mediaDuration = embeddedMediaInfo?.duration || 0;
    const runtimeDuration = payload?.runtime ? Number(payload.runtime) * 60 : 0;

    if (mediaDuration > 60) return mediaDuration;
    if (runtimeDuration > 60) return runtimeDuration;
    return 0;
  }, [embeddedMediaInfo?.duration, payload?.runtime]);
  const resolvedDuration = useMemo(() => {
    if (authoritativeDuration > 0) return authoritativeDuration;
    return duration > 0 ? duration : 0;
  }, [authoritativeDuration, duration]);
  const activeSubtitleCue = useMemo(() => {
    if (manualSubtitleCues.length === 0) return null;
    return manualSubtitleCues.find((cue) => currentTime >= cue.start && currentTime <= cue.end) || null;
  }, [currentTime, manualSubtitleCues]);

  useEffect(() => {
    if (!activeSubtitleCue?.text) return;
    void logPlayer('html5-active-subtitle-cue', {
      currentTime,
      text: activeSubtitleCue.text.slice(0, 120)
    });
  }, [activeSubtitleCue?.text, currentTime]);

  useEffect(() => {
    if (!payload) return;
    audioSelectionTouchedRef.current = false;
    audioAutoAppliedRef.current = false;
    pendingSeekRef.current = null;
    resumeAppliedRef.current = false;
    setSelectedAudioTrackId(null);
    setSelectedSubtitleTrackId('off');
    setManualSubtitleCues([]);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackTimeOffset(0);
    setPlaybackSrc(payload.playbackUrl || payload.url || '');
    subtitleCueCacheRef.current.clear();

    if (payload.playerBackend === 'mpv') {
      setMode('mpv');
      setStatus('Playing with app player...');
      return;
    }

    if (payload.playerBackend === 'html5') {
      setMode('html5');
      setStatus('Playing through in-app stream...');
      return;
    }

    if (window.desktopPlayer) {
      setMode('mpv');
      setStatus('Playing with app player (Japanese audio, English subtitles)...');
      return;
    }

    setMode('html5');
    setStatus('Playing through browser stream...');
  }, [payload, streamSrc]);

  useEffect(() => {
    setSubtitleStatus(subtitleTracks.length > 0 ? `${subtitleTracks.length} subtitle track available` : 'No subtitle track provided');
  }, [subtitleTracks.length]);

  useEffect(() => {
    if (selectedSubtitleTrackId !== 'off') return;

    if (subtitleTracks.length > 0) {
      const preferred = subtitleTracks
        .filter((track) => track.streamIndex === undefined)
        .slice()
        .sort((a, b) => scoreSubtitleTrack(a) - scoreSubtitleTrack(b))[0];
      if (preferred) {
        setSelectedSubtitleTrackId(preferred.id);
      }
      return;
    }

    if (subtitleTracks.length === 0 && subtitleTracksExposed.length > 0) {
      const preferred = subtitleTracksExposed
        .slice()
        .sort((a, b) => scoreSubtitleTrack(a) - scoreSubtitleTrack(b))[0];
      if (preferred) {
        setSelectedSubtitleTrackId(preferred.id);
      }
    }
  }, [selectedSubtitleTrackId, subtitleTracks, subtitleTracksExposed]);

  useEffect(() => {
    if (selectedAudioTrackId !== null) return;

    if (audioTracks.length > 0) {
      const preferred = audioTracks
        .slice()
        .sort((a, b) => scoreAudioTrack(a) - scoreAudioTrack(b))[0];
      if (preferred) {
        setSelectedAudioTrackId(preferred.id);
      }
      return;
    }

    const fallbackTracks =
      embeddedMediaInfo?.audioTracks.map((track) => ({
        id: track.index,
        label: track.title || track.language || `Audio ${track.index}`,
        language: track.language || 'und'
      })) || [];

    if (fallbackTracks.length > 0) {
      const preferred = fallbackTracks
        .slice()
        .sort((a, b) => scoreAudioTrack(a) - scoreAudioTrack(b))[0];
      if (preferred) {
        setSelectedAudioTrackId(preferred.id);
      }
    }
  }, [audioTracks, embeddedMediaInfo?.audioTracks, selectedAudioTrackId]);

  useEffect(() => {
    if (!playbackId || mode !== 'html5') return;

    const controller = new AbortController();

    async function loadEmbeddedMediaInfo() {
      try {
        const response = await fetch(`${API_URL}/streams/play/${playbackId}/media-info`, {
          signal: controller.signal
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Unable to probe media info');
        }

        setEmbeddedMediaInfo(data);
        void logPlayer('ffprobe-media-info', data);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        void logPlayer('ffprobe-media-info-error', {
          message: error instanceof Error ? error.message : 'unknown error'
        });
      }
    }

    void loadEmbeddedMediaInfo();
    return () => controller.abort();
  }, [mode, playbackId]);

  async function logPlayer(message: string, details?: unknown) {
    try {
      await window.desktopPlayer?.log?.(message, details);
    } catch {
      // Ignore logging failures in renderer.
    }
  }

  function loadRemuxedAudioTrack(trackId: number, startAt: number, reason: 'auto-default' | 'manual-select' | 'cycle' | 'seek') {
    if (!playbackId) return;

    const normalizedStart = Math.max(0, startAt || 0);
    pendingSeekRef.current = normalizedStart;
    setPlaybackTimeOffset(normalizedStart);
    setCurrentTime(normalizedStart);
    setPlaybackSrc(
      `${API_URL}/streams/play/${playbackId}/audio/${trackId}?start=${encodeURIComponent(String(normalizedStart))}&t=${Date.now()}`
    );
    void logPlayer('html5-audio-remux-load', {
      reason,
      selectedAudioTrackId: trackId,
      currentTimeSnapshot: normalizedStart
    });
  }

  useEffect(() => {
    if (!streamSrc || mode !== 'mpv' || duration > 0 || !desktopError) return;

    const normalized = desktopError.toLowerCase();
    if (!/(mpv|ipc|pipe|invalid id|unable to start)/.test(normalized)) {
      return;
    }

    setMode('html5');
    setStatus('Using in-app stream fallback...');
  }, [desktopError, duration, mode, streamSrc]);

  useEffect(() => {
    if (!window.desktopPlayer?.onState) return;

    return window.desktopPlayer.onState((state: DesktopPlayerState) => {
      if (typeof state.currentTime === 'number') {
        setCurrentTime(state.currentTime);
      }
      if (typeof state.duration === 'number' && state.duration > 0) {
        setDuration(state.duration);
        setStatus('Playing');
      }
      if (typeof state.paused === 'boolean') {
        setPlaying(!state.paused);
      }
      if (state.lastError) {
        setDesktopError(state.lastError);
      }
    });
  }, []);

  function refreshBrowserTracks(reason: string) {
    const video = videoRef.current;
    if (!video) return;

    const nextAudioTracks = readAudioTracks(video);
    const nextSubtitleTracks = readSubtitleTracks(video);
    setAudioTracks(nextAudioTracks);
    setSubtitleTracksExposed(nextSubtitleTracks);

    void logPlayer('html5-track-scan', {
      reason,
      embeddedSubtitlesLikely: payload?.embeddedSubtitlesLikely || false,
      embeddedAudioTracksLikely: payload?.embeddedAudioTracksLikely || false,
      audioTracks: nextAudioTracks,
      subtitleTracks: nextSubtitleTracks
    });

    if (nextAudioTracks.length > 0 && selectedAudioTrackId === null) {
      const preferredAudio = nextAudioTracks.slice().sort((a, b) => scoreAudioTrack(a) - scoreAudioTrack(b))[0];
      if (preferredAudio) {
        setSelectedAudioTrackId(preferredAudio.id);
      }
    }

    if (subtitleTracks.length === 0 && nextSubtitleTracks.length > 0 && selectedSubtitleTrackId === 'off') {
      const preferredSubtitle = nextSubtitleTracks.slice().sort((a, b) => scoreSubtitleTrack(a) - scoreSubtitleTrack(b))[0];
      if (preferredSubtitle) {
        setSelectedSubtitleTrackId(preferredSubtitle.id);
      }
    }
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || mode !== 'html5') return;

    const timer = window.setTimeout(() => refreshBrowserTracks('delayed-scan'), 1200);
    return () => window.clearTimeout(timer);
  }, [embeddedMediaInfo?.audioTracks, mode, streamSrc]);

  useEffect(() => {
    const video = videoRef.current as HTMLVideoElement & {
      audioTracks?: ArrayLike<{ enabled?: boolean }>;
    };
    if (!video?.audioTracks || selectedAudioTrackId === null) return;

    for (let index = 0; index < video.audioTracks.length; index += 1) {
      const track = video.audioTracks[index];
      if (track) {
        track.enabled = index === selectedAudioTrackId;
      }
    }

    setAudioTracks(readAudioTracks(videoRef.current));
    void logPlayer('html5-audio-selected', { selectedAudioTrackId });
  }, [selectedAudioTrackId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const selectedExternalTrack = subtitleTracks.find((track) => track.id === selectedSubtitleTrackId) || null;

    for (let index = 0; index < video.textTracks.length; index += 1) {
      const track = video.textTracks[index];
      const shouldShow = !selectedExternalTrack && selectedSubtitleTrackId !== 'off' && selectedSubtitleTrackId === `text-${index}`;
      track.mode = shouldShow ? 'showing' : 'disabled';
    }

    if (selectedSubtitleTrackId === 'off') {
      setManualSubtitleCues([]);
      setSubtitleStatus((current) => (current.includes('ready') ? 'Subtitles off' : current));
      setSubtitleTracksExposed(readSubtitleTracks(videoRef.current));
      void logPlayer('html5-subtitle-selected', {
        selectedSubtitleTrackId,
        external: false
      });
      return;
    }

    if (!selectedExternalTrack) {
      setManualSubtitleCues([]);
      setSubtitleTracksExposed(readSubtitleTracks(videoRef.current));
      void logPlayer('html5-subtitle-selected', {
        selectedSubtitleTrackId,
        external: false
      });
      return;
    }

    let cancelled = false;

    const loadExternalTrack = async () => {
      try {
        const cachedCues = subtitleCueCacheRef.current.get(selectedExternalTrack.id);
        if (cachedCues) {
          setManualSubtitleCues(cachedCues);
          setSubtitleStatus(`${selectedExternalTrack.label} ready`);
          setSubtitleTracksExposed(readSubtitleTracks(videoRef.current));
          void logPlayer('html5-external-track-cache-hit', {
            selectedSubtitleTrackId,
            cueCount: cachedCues.length
          });
          return;
        }

        const response = await fetch(
          `${selectedExternalTrack.src}${selectedExternalTrack.src.includes('?') ? '&' : '?'}t=${Date.now()}`
        );
        const subtitleText = await response.text();
        const cues = parseSubtitleText(subtitleText);

        if (cancelled) return;
        subtitleCueCacheRef.current.set(selectedExternalTrack.id, cues);
        setManualSubtitleCues(cues);
        setSubtitleStatus(
          cues.length > 0 ? `${selectedExternalTrack.label} ready` : `${selectedExternalTrack.label} has no visible cues`
        );
        setSubtitleTracksExposed(readSubtitleTracks(videoRef.current));
        void logPlayer('html5-external-track-manual-ready', {
          selectedSubtitleTrackId,
          cueCount: cues.length,
          responseSample: subtitleText.slice(0, 140),
          sample: cues[0]?.text?.slice(0, 80) || null
        });
      } catch (error) {
        if (cancelled) return;
        setSubtitleStatus(`${selectedExternalTrack.label} failed to load`);
        void logPlayer('html5-external-track-manual-error', {
          selectedSubtitleTrackId,
          message: error instanceof Error ? error.message : 'unknown error'
        });
      }
    };

    setSubtitleStatus(`Loading ${selectedExternalTrack.label}...`);
    void loadExternalTrack();
    return () => {
      cancelled = true;
    };
  }, [selectedSubtitleTrackId, subtitleTracks]);

  useEffect(() => {
    if (mode !== 'html5' || selectedAudioTrackId === null || audioTracks.length > 0 || !playbackId) return;
    if ((embeddedMediaInfo?.audioTracks.length || 0) < 2) return;
    if (currentAudioRemuxTrackId === selectedAudioTrackId) return;

    const currentTimeSnapshot = videoRef.current?.currentTime || currentTime || 0;
    const isAutomaticDefault = !audioSelectionTouchedRef.current && !audioAutoAppliedRef.current;
    if (!audioSelectionTouchedRef.current && !isAutomaticDefault) return;

    if (isAutomaticDefault) {
      audioAutoAppliedRef.current = true;
    }

    loadRemuxedAudioTrack(
      selectedAudioTrackId,
      currentTimeSnapshot,
      isAutomaticDefault ? 'auto-default' : 'manual-select'
    );
  }, [audioTracks.length, currentAudioRemuxTrackId, currentTime, embeddedMediaInfo?.audioTracks.length, mode, playbackId, selectedAudioTrackId]);

  useEffect(() => {
    if (!payload?.showId || !payload.episodeNumber || currentTime <= 0) return;
    if (Date.now() - lastProgressWriteRef.current < 2500) return;

    lastProgressWriteRef.current = Date.now();
    saveWatchProgress({
      key: `${payload.showId}:${payload.seasonNumber || 1}:${payload.episodeNumber}`,
      showId: payload.showId,
      showTitle: payload.showTitle || payload.title || 'Untitled anime',
      posterUrl: payload.posterUrl,
      backdropUrl: payload.backdropUrl,
      seasonNumber: payload.seasonNumber,
      episodeNumber: payload.episodeNumber,
      episodeTitle: payload.episodeTitle,
      stillUrl: payload.stillUrl,
      runtime: payload.runtime,
      currentTime,
      duration: duration || (payload.runtime ? Number(payload.runtime) * 60 : 0),
      updatedAt: Date.now(),
      nextAirDate: payload.nextAirDate
    });
  }, [currentTime, duration, payload]);

  async function goBack() {
    if (mode === 'mpv' && window.desktopPlayer?.control) {
      await window.desktopPlayer.control({ command: 'close-player' });
    }

    if (payload?.returnTo) {
      try {
        await router.replace(payload.returnTo);
      } catch {
        window.location.href = payload.returnTo;
      }
      return;
    }

    await router.push('/');
  }

  async function togglePlay() {
    if (mode === 'mpv' && window.desktopPlayer?.control) {
      await window.desktopPlayer.control({ command: 'toggle-pause' });
      setPlaying((value) => !value);
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      await video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  function cycleAudioTrack() {
    if (mode === 'mpv') {
      void window.desktopPlayer?.control?.({ command: 'cycle-audio' });
      return;
    }

    if (audioTracks.length === 0) {
      const fallbackAudioTracks =
        embeddedMediaInfo?.audioTracks.map((track) => ({
          id: track.index,
          label: track.title || track.language || `Audio ${track.index}`,
          language: track.language || 'und',
          enabled: selectedAudioTrackId === track.index
        })) || [];

      if (fallbackAudioTracks.length === 0) {
        setSubtitleStatus(payload?.embeddedAudioTracksLikely ? 'Embedded audio likely, but browser exposed no selectable audio tracks' : 'No alternate audio track exposed');
        void logPlayer('html5-audio-cycle-empty', { embeddedAudioTracksLikely: payload?.embeddedAudioTracksLikely || false });
        return;
      }

      const currentIndex = fallbackAudioTracks.findIndex((track) => track.id === selectedAudioTrackId);
      const nextTrack = fallbackAudioTracks[(currentIndex + 1) % fallbackAudioTracks.length] || fallbackAudioTracks[0];
      audioSelectionTouchedRef.current = true;
      setSelectedAudioTrackId(nextTrack.id);
      setSubtitleStatus(`Audio: ${nextTrack.label}`);
      return;
    }

    const currentIndex = audioTracks.findIndex((track) => track.id === selectedAudioTrackId);
    const nextTrack = audioTracks[(currentIndex + 1) % audioTracks.length] || audioTracks[0];
    setSelectedAudioTrackId(nextTrack.id);
    setSubtitleStatus(`Audio: ${nextTrack.label}`);
  }

  function selectAudioTrack(value: string) {
    const nextId = Number(value);
    if (!Number.isFinite(nextId)) return;

    const nextTrack = audioOptions.find((track) => track.id === nextId);
    audioSelectionTouchedRef.current = true;
    setSelectedAudioTrackId(nextId);
    if (nextTrack) {
      setSubtitleStatus(`Audio: ${nextTrack.label}`);
    }
  }

  function cycleSubtitleTrack() {
    if (mode === 'mpv') {
      void window.desktopPlayer?.control?.({ command: 'cycle-subtitles' });
      return;
    }

    if (subtitleTracksExposed.length === 0) {
      setSubtitleStatus(payload?.embeddedSubtitlesLikely ? 'Embedded subtitles likely, but browser exposed no subtitle tracks' : 'No subtitle track exposed');
      void logPlayer('html5-subtitle-cycle-empty', { embeddedSubtitlesLikely: payload?.embeddedSubtitlesLikely || false });
      return;
    }

    const ids = ['off', ...subtitleTracksExposed.map((track) => track.id)];
    const currentIndex = ids.indexOf(selectedSubtitleTrackId);
    const nextId = ids[(currentIndex + 1) % ids.length] || 'off';
    setSelectedSubtitleTrackId(nextId);

    const nextTrack = subtitleTracksExposed.find((track) => track.id === nextId);
    setSubtitleStatus(nextTrack ? `Subtitles: ${nextTrack.label}` : 'Subtitles off');
  }

  function selectSubtitleTrack(value: string) {
    setSelectedSubtitleTrackId(value);
    const nextTrack = subtitleOptions.find((track) => track.id === value);
    setSubtitleStatus(nextTrack ? `Subtitles: ${nextTrack.label}` : 'Subtitles off');
  }

  async function seekTo(next: number) {
    if (mode === 'mpv' && window.desktopPlayer?.control) {
      await window.desktopPlayer.control({ command: 'seek-absolute', value: next });
      setCurrentTime(next);
      return;
    }

    if (isRemuxedPlayback && playbackId && selectedAudioTrackId !== null) {
      const clamped = Math.max(0, Math.min(next, resolvedDuration || next));
      loadRemuxedAudioTrack(selectedAudioTrackId, clamped, 'seek');
      void logPlayer('html5-audio-remux-seek', {
        selectedAudioTrackId,
        nextTime: clamped
      });
      return;
    }

    if (videoRef.current) {
      videoRef.current.currentTime = next;
      setCurrentTime(next);
    }
  }

  if (!payload) {
    return (
      <main className="internalPlayerShell">
        <div className="internalPlayerNotice">Missing player payload.</div>
      </main>
    );
  }

  if (mode === 'mpv') {
    return (
      <main className="internalPlayerShell">
        <div className="internalPlayerStage mpvStage" />
      </main>
    );
  }

  return (
    <main className="internalPlayerShell">
      {mode === 'html5' && streamSrc && (
        <div className="internalPlayerStage">
          <video
            ref={videoRef}
            className="internalHtmlVideo"
            src={playbackSrc || streamSrc}
            autoPlay
            playsInline
            controls={false}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onLoadedMetadata={(event) => {
              const total = event.currentTarget.duration || 0;
              if (authoritativeDuration > 0) {
                setDuration(authoritativeDuration);
              } else if (Number.isFinite(total) && total > 0) {
                setDuration(isRemuxedPlayback ? total + playbackTimeOffset : total);
              }
              if (!resumeAppliedRef.current && (payload.resumeTime || 0) > 0) {
                event.currentTarget.currentTime = Math.min(payload.resumeTime || 0, total || payload.resumeTime || 0);
                resumeAppliedRef.current = true;
              }
              if (pendingSeekRef.current !== null && pendingSeekRef.current > 0) {
                event.currentTarget.currentTime = Math.min(pendingSeekRef.current, total || pendingSeekRef.current);
                pendingSeekRef.current = null;
              }
              setStatus('Playing');
              refreshBrowserTracks('loaded-metadata');
            }}
            onDurationChange={(event) => {
              const nextDuration = event.currentTarget.duration || 0;
              if (authoritativeDuration > 0) {
                setDuration(authoritativeDuration);
              } else if (Number.isFinite(nextDuration) && nextDuration > 0) {
                setDuration(isRemuxedPlayback ? nextDuration + playbackTimeOffset : nextDuration);
              }
            }}
            onTimeUpdate={(event) => {
              const rawTime = event.currentTarget.currentTime || 0;
              setCurrentTime(rawTime + playbackTimeOffset);
              if ((!duration || duration < 5) && authoritativeDuration > 0) {
                setDuration(authoritativeDuration);
              }
            }}
            onError={(event) => {
              setStatus('Browser playback failed. Install mpv and place mpv.exe in desktop/bin for MKV support.');
              void logPlayer('html5-video-error', {
                currentSrc: event.currentTarget.currentSrc || streamSrc
              });
            }}
          >
          </video>
          {activeSubtitleCue?.text ? (
            <div className="internalSubtitleOverlay" aria-live="polite">
              {activeSubtitleCue.text.split('\n').map((line, index) => (
                <span key={`${activeSubtitleCue.start}-${index}`}>{line}</span>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <div className="internalPlayerOverlay top">
        <button type="button" className="internalIconButton" onClick={() => void goBack()} title="Back">
          <ArrowLeft size={20} />
        </button>
        <div className="internalPlayerTitle">
          <strong>{payload.episodeTitle || payload.title || 'Anime Hub Player'}</strong>
          <span>{status}</span>
        </div>
        <button
          type="button"
          className="internalIconButton"
          onClick={() => void window.desktopPlayer?.control?.({ command: 'toggle-fullscreen' })}
          title="Fullscreen"
        >
          <Maximize2 size={20} />
        </button>
      </div>

      <div className="internalPlayerControlDock">
        <div className="timelineRow internalTimelineRow">
          <span>{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={resolvedDuration || 0}
            value={Math.min(currentTime, resolvedDuration || currentTime)}
            onChange={(event) => void seekTo(Number(event.target.value))}
          />
          <span>{formatTime(resolvedDuration)}</span>
        </div>

        <div className="internalPlayerControls internalControlBar">
          <button type="button" className="internalIconButton primary" onClick={() => void togglePlay()} title={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <label className="internalSelectWrap" title="Subtitles">
            <Subtitles size={16} />
            <select value={selectedSubtitleTrackId} onChange={(event) => selectSubtitleTrack(event.target.value)}>
              <option value="off">Subtitles Off</option>
              {subtitleOptions.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.label}
                </option>
              ))}
            </select>
          </label>
          <label className="internalSelectWrap" title="Audio">
            <Volume2 size={16} />
            <select
              value={selectedAudioTrackId !== null ? String(selectedAudioTrackId) : ''}
              onChange={(event) => selectAudioTrack(event.target.value)}
            >
              <option value="" disabled>
                Audio
              </option>
              {audioOptions.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="internalTextButton" onClick={() => void seekTo(Math.max(0, currentTime - 10))}>
            -10s
          </button>
          <button type="button" className="internalTextButton" onClick={() => void seekTo(currentTime + 10)}>
            +10s
          </button>
        </div>
      </div>
      {subtitleStatus && <div className="internalPlayerMetaNote">{subtitleStatus}</div>}
      {desktopError && <div className="internalPlayerErrorNote">{desktopError}</div>}
      {mode === 'loading' && <div className="internalPlayerLoadingNote">Preparing stream...</div>}
    </main>
  );
}
