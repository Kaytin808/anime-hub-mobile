import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Check, Maximize2, Pause, Play, Settings, Subtitles, Volume2 } from 'lucide-react';
import { saveWatchProgress } from '../utils/watch-progress';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const PLAYBACK_MODE_KEY = 'animeHub.playbackMode';

type PlaybackMode = 'subbed' | 'dubbed';

type SubtitleTrack = {
  id: string;
  provider: string;
  label: string;
  language: string;
  url: string;
};

type AudioTrackOption = {
  id: number;
  label: string;
  language: string;
  enabled: boolean;
};

const scoreAudioOption = (track: Pick<AudioTrackOption, 'label' | 'language'>) => {
  const language = (track.language || '').toLowerCase();
  const label = (track.label || '').toLowerCase();

  if (/(^|[^a-z])(ja|jpn|japanese)($|[^a-z])/.test(language) || /japanese|original/.test(label)) {
    return 0;
  }
  if (language && !/(^|[^a-z])(en|eng|english)($|[^a-z])/.test(language) && !/dub|english/.test(label)) {
    return 30;
  }
  if (/(^|[^a-z])(en|eng|english)($|[^a-z])/.test(language) || /english|dub/.test(label)) {
    return 80;
  }
  return 50;
};

const scoreSubtitleTrack = (track: Pick<SubtitleTrack, 'label' | 'language'>) => {
  const language = (track.language || '').toLowerCase();
  const label = (track.label || '').toLowerCase();

  let score = 100;
  if (/(^|[^a-z])(en|eng|english)($|[^a-z])/.test(language) || /english|full|dialog/.test(label)) {
    score = 0;
  } else if (language && language !== 'und') {
    score = 40;
  }

  if (/sign/.test(label)) score += 120;
  if (/song/.test(label)) score += 60;
  if (/forced/.test(label)) score += 25;

  return score;
};

const pickPreferredAudioTrackId = (tracks: AudioTrackOption[]) =>
  tracks
    .slice()
    .sort((a, b) => scoreAudioOption(a) - scoreAudioOption(b))[0]?.id ?? null;

const pickPreferredSubtitleId = (tracks: SubtitleTrack[]) =>
  tracks
    .slice()
    .sort((a, b) => scoreSubtitleTrack(a) - scoreSubtitleTrack(b))[0]?.id ?? 'off';

type VideoPlayerProps = {
  playbackUrl?: string;
  directUrl?: string;
  container?: string;
  quality?: string;
  filename?: string;
  subtitles?: string[];
  embeddedSubtitlesLikely?: boolean;
  embeddedAudioTracksLikely?: boolean;
  title?: string;
  originalTitle?: string;
  imdbId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  showId?: number;
  showTitle?: string;
  posterUrl?: string;
  backdropUrl?: string;
  stillUrl?: string;
  runtime?: number;
  nextAirDate?: string;
  resumeTime?: number;
  onBack?: () => void;
};

const browserFriendly = (container?: string, filename?: string) => {
  const value = (container || filename || '').toLowerCase();
  return /mp4|webm|m4v|mov/.test(value);
};

const getAudioTracks = (video: HTMLVideoElement | null): AudioTrackOption[] => {
  const media = video as HTMLVideoElement & {
    audioTracks?: ArrayLike<{
      id?: string;
      label?: string;
      language?: string;
      enabled?: boolean;
    }>;
  };

  if (!media?.audioTracks || media.audioTracks.length === 0) {
    return [];
  }

  return Array.from({ length: media.audioTracks.length }, (_, index) => {
    const track = media.audioTracks?.[index];
    return {
      id: index,
      label: track?.label || track?.language || `Audio ${index + 1}`,
      language: track?.language || 'und',
      enabled: Boolean(track?.enabled)
    };
  });
};

export default function VideoPlayer({
  playbackUrl,
  directUrl,
  container,
  quality,
  filename,
  subtitles,
  embeddedSubtitlesLikely,
  embeddedAudioTracksLikely,
  title,
  originalTitle,
  imdbId,
  seasonNumber,
  episodeNumber,
  episodeTitle,
  showId,
  showTitle,
  posterUrl,
  backdropUrl,
  stillUrl,
  runtime,
  nextAirDate,
  resumeTime,
  onBack
}: VideoPlayerProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackError, setPlaybackError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [desktopError, setDesktopError] = useState('');
  const [desktopPlayerAvailable, setDesktopPlayerAvailable] = useState(false);
  const [desktopEmbeddedAvailable, setDesktopEmbeddedAvailable] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [nativeSubtitleTracks, setNativeSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState('off');
  const [subtitleStatus, setSubtitleStatus] = useState('');
  const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [desktopLaunchPending, setDesktopLaunchPending] = useState(false);
  const [desktopLaunchSucceeded, setDesktopLaunchSucceeded] = useState(false);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('subbed');
  const lastProgressWriteRef = useRef(0);
  const resumeAppliedRef = useRef(false);
  const subtitleAutoPickedRef = useRef(false);
  const audioAutoPickedRef = useRef(false);
  const desktopLaunchRef = useRef<string | null>(null);
  const desktopRoutePushRef = useRef<string | null>(null);
  const internalLaunchRef = useRef<string | null>(null);

  const src = playbackUrl || directUrl || '';
  const externalUrl = directUrl || playbackUrl || '';
  const selectedSubtitle = useMemo(
    () => [...nativeSubtitleTracks, ...subtitleTracks].find((track) => track.id === selectedSubtitleId),
    [nativeSubtitleTracks, selectedSubtitleId, subtitleTracks]
  );
  const allSubtitleTracks = useMemo(
    () => [...nativeSubtitleTracks, ...subtitleTracks],
    [nativeSubtitleTracks, subtitleTracks]
  );

  useEffect(() => {
    setPlaybackError(false);
    setCopied(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setDesktopError('');
    setSelectedSubtitleId('off');
    setSubtitleTracks([]);
    setNativeSubtitleTracks([]);
    setSubtitleStatus('');
    setAudioTracks([]);
    setSelectedAudioTrackId(null);
    setDesktopLaunchPending(false);
    setDesktopLaunchSucceeded(false);
    resumeAppliedRef.current = false;
    subtitleAutoPickedRef.current = false;
    audioAutoPickedRef.current = false;
    desktopLaunchRef.current = null;
    desktopRoutePushRef.current = null;
    internalLaunchRef.current = null;
  }, [src]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    setDesktopPlayerAvailable(Boolean(window.desktopPlayer));
    const savedMode = window.localStorage.getItem(PLAYBACK_MODE_KEY);
    setPlaybackMode(savedMode === 'dubbed' ? 'dubbed' : 'subbed');
    if (!window.desktopPlayer?.getCapabilities) return;

    void window.desktopPlayer
      .getCapabilities()
      .then((capabilities) => {
        setDesktopEmbeddedAvailable(Boolean(capabilities?.embedded));
      })
      .catch(() => {
        setDesktopEmbeddedAvailable(false);
      });
  }, []);

  useEffect(() => {
    if (!src) return;

    const controller = new AbortController();
    const embedded = (subtitles || []).map((url, index) => ({
      id: `embedded-${index}`,
      provider: 'embedded',
      label: `Embedded subtitle ${index + 1}`,
      language: 'und',
      url
    }));

    setSubtitleTracks(embedded);
    setSubtitleStatus('Searching subtitles...');

    async function loadSubtitles() {
      try {
        const res = await fetch(`${API_URL}/subtitles/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            title,
            originalTitle,
            imdbId,
            seasonNumber,
            episodeNumber,
            episodeTitle,
            filename,
            embedded: subtitles || []
          })
        });
        const data = await res.json();
        const nextTracks = Array.isArray(data.subtitles) ? data.subtitles : embedded;
        setSubtitleTracks(nextTracks);
        setSubtitleStatus(
          nextTracks.length > 0
            ? `${nextTracks.length} subtitle option${nextTracks.length === 1 ? '' : 's'} found`
            : embeddedSubtitlesLikely
            ? 'Embedded subtitle tracks likely. Use app player if the browser does not expose them.'
            : data.message || data.error || 'No subtitles found'
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setSubtitleTracks(embedded);
        setSubtitleStatus(
          embedded.length > 0
            ? 'Using embedded subtitles'
            : embeddedSubtitlesLikely
            ? 'Embedded subtitle tracks likely. Use app player if the browser does not expose them.'
            : 'No subtitle source available'
        );
      }
    }

    void loadSubtitles();
    return () => controller.abort();
  }, [embeddedSubtitlesLikely, episodeNumber, episodeTitle, filename, imdbId, originalTitle, seasonNumber, src, subtitles, title]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    for (let index = 0; index < video.textTracks.length; index += 1) {
      const track = video.textTracks[index];
      const matchingExternal = subtitleTracks.find((item) => item.label === track.label);
      const selectedNativeIndex = selectedSubtitleId.startsWith('native-')
        ? Number(selectedSubtitleId.replace('native-', ''))
        : -1;
      const shouldShow =
        selectedSubtitleId !== 'off' &&
        (index === selectedNativeIndex || matchingExternal?.id === selectedSubtitleId);

      track.mode = shouldShow ? 'showing' : 'disabled';
    }
  }, [nativeSubtitleTracks, selectedSubtitleId, subtitleTracks]);

  useEffect(() => {
    const timer = window.setTimeout(() => refreshNativeSubtitleTracks(), 100);
    return () => window.clearTimeout(timer);
  }, [subtitleTracks]);

  useEffect(() => {
    if (subtitleAutoPickedRef.current) return;
    if (selectedSubtitleId !== 'off') return;

    const preferred = pickPreferredSubtitleId(allSubtitleTracks);
    if (preferred !== 'off') {
      subtitleAutoPickedRef.current = true;
      setSelectedSubtitleId(preferred);
    }
  }, [allSubtitleTracks, selectedSubtitleId]);

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
    setAudioTracks(getAudioTracks(videoRef.current));
  }, [selectedAudioTrackId]);

  const likelyUnsupported = !browserFriendly(container, filename);

  async function copyLink() {
    if (!externalUrl) return;
    try {
      await navigator.clipboard.writeText(externalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function formatTime(value: number) {
    if (!Number.isFinite(value) || value <= 0) return '0:00';
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }

  function toggleFullscreen() {
    const video = videoRef.current;
    const containerElement = video?.closest('.videoPlayer');
    if (containerElement instanceof HTMLElement && containerElement.requestFullscreen) {
      void containerElement.requestFullscreen();
    }
  }

  function refreshAudioTracks() {
    const nextTracks = getAudioTracks(videoRef.current);
    setAudioTracks(nextTracks);
    const enabled = nextTracks.find((track) => track.enabled);
    const preferred = pickPreferredAudioTrackId(nextTracks);
    setSelectedAudioTrackId(enabled?.id ?? preferred ?? nextTracks[0]?.id ?? null);
    audioAutoPickedRef.current = true;
  }

  function refreshNativeSubtitleTracks() {
    const video = videoRef.current;
    if (!video) return;

    const externalLabels = new Set(subtitleTracks.map((track) => track.label));
    const nativeTracks: SubtitleTrack[] = [];

    for (let index = 0; index < video.textTracks.length; index += 1) {
      const track = video.textTracks[index];
      const label = track.label || track.language || `Embedded subtitles ${index + 1}`;
      if (externalLabels.has(label)) {
        continue;
      }

      nativeTracks.push({
        id: `native-${index}`,
        provider: 'embedded',
        label,
        language: track.language || 'und',
        url: ''
      });
    }

    setNativeSubtitleTracks(nativeTracks);
  }

  function persistProgress(time: number, total: number) {
    if (!showId || !episodeNumber || Date.now() - lastProgressWriteRef.current < 2500) {
      return;
    }

    lastProgressWriteRef.current = Date.now();
    saveWatchProgress({
      key: `${showId}:${seasonNumber || 1}:${episodeNumber}`,
      showId,
      showTitle: showTitle || title || 'Untitled anime',
      posterUrl,
      backdropUrl,
      seasonNumber,
      episodeNumber,
      episodeTitle,
      stillUrl,
      runtime,
      currentTime: time,
      duration: total || runtime ? (total || Number(runtime) * 60) : 0,
      updatedAt: Date.now(),
      nextAirDate
    });
  }

  function cycleSubtitles() {
    if (allSubtitleTracks.length === 0) return;
    const ids = ['off', ...allSubtitleTracks.map((track) => track.id)];
    const currentIndex = ids.indexOf(selectedSubtitleId);
    setSelectedSubtitleId(ids[(currentIndex + 1) % ids.length]);
  }

  async function playInDesktopPlayer() {
    if (!window.desktopPlayer || !externalUrl) {
      return false;
    }

    setDesktopLaunchPending(true);
    setDesktopError('');
    const result = await window.desktopPlayer.play({
      url: externalUrl,
      title: filename || title || 'Anime Hub Player',
      subtitleUrl: selectedSubtitle?.url || undefined,
      returnTo: showId ? `/anime/${showId}` : router.asPath,
      playbackMode
    });

    if (!result.ok) {
      setDesktopError(result.error || 'Unable to start desktop player');
      setDesktopLaunchPending(false);
      setDesktopLaunchSucceeded(false);
      return false;
    }

    setDesktopLaunchPending(false);
    setDesktopLaunchSucceeded(true);
    return true;
  }

  useEffect(() => {
    if (!window.desktopPlayer?.onState) return;
    if (!showId || !episodeNumber) return;

    return window.desktopPlayer.onState((state) => {
      const time = Number(state.currentTime) || 0;
      const total = Number(state.duration) || 0;
      if (time > 0) {
        persistProgress(time, total);
        setCurrentTime(time);
        if (total > 0) {
          setDuration(total);
        }
      }
    });
  }, [episodeNumber, runtime, seasonNumber, showId, showTitle, title]);

  if (!src) {
    return null;
  }

  if (desktopPlayerAvailable && desktopEmbeddedAvailable && desktopLaunchSucceeded) {
    return (
      <div className="videoPlayer">
        <div className="videoFallback">
          <p>Playing in the app player.</p>
          <p className="hint">
            The episode is being moved into the full in-app player view.
          </p>
          <div className="videoFallbackActions">
            <button type="button" onClick={() => void copyLink()}>
              {copied ? 'Copied!' : 'Copy RealDebrid URL'}
            </button>
            <button type="button" onClick={onBack || (() => history.back())}>
              Back
            </button>
          </div>
          {desktopError && <p className="hint">{desktopError}</p>}
        </div>

        <div className="videoMeta">
          {quality && <span>{quality}</span>}
          {container && <span>{container.toUpperCase()}</span>}
          {embeddedSubtitlesLikely && <span>Embedded subs likely</span>}
          {embeddedAudioTracksLikely && <span>Embedded audio likely</span>}
          {filename && <span className="filename">{filename}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="videoPlayer">
      {!playbackError ? (
        <div className="playerCanvas">
          <video
            ref={videoRef}
            key={src}
            autoPlay
            playsInline
            preload="metadata"
            src={src}
            onClick={togglePlay}
            onPlay={() => setPlaying(true)}
            onPause={(event) => {
              setPlaying(false);
              persistProgress(event.currentTarget.currentTime || 0, event.currentTarget.duration || 0);
            }}
            onLoadedMetadata={(event) => {
              setDuration(event.currentTarget.duration || 0);
              if (!resumeAppliedRef.current && Number.isFinite(resumeTime) && (resumeTime || 0) > 0) {
                event.currentTarget.currentTime = Math.max(0, Math.min(resumeTime || 0, event.currentTarget.duration || resumeTime || 0));
                setCurrentTime(event.currentTarget.currentTime || 0);
                resumeAppliedRef.current = true;
              }
              refreshAudioTracks();
              refreshNativeSubtitleTracks();
            }}
            onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime || 0;
              const total = event.currentTarget.duration || 0;
              setCurrentTime(time);
              persistProgress(time, total);
            }}
            onError={() => setPlaybackError(true)}
          >
            {subtitleTracks.map((track) => (
              <track
                key={track.id}
                kind="subtitles"
                src={track.url}
                srcLang={track.language || 'en'}
                label={track.label}
                default={track.id === selectedSubtitleId}
              />
            ))}
            Your browser does not support video playback.
          </video>
          <div className="playerOverlay top">
            <div className="playerTitle">
              <button type="button" className="iconButton" onClick={onBack || (() => history.back())} title="Back">
                <ArrowLeft size={20} />
              </button>
              <span>{episodeTitle || filename || title || 'Now Playing'}</span>
            </div>
            <button type="button" className="iconButton" onClick={toggleFullscreen} title="Fullscreen">
              <Maximize2 size={20} />
            </button>
          </div>
          <div className="playerOverlay bottom">
            <div className="timelineRow">
              <span>{formatTime(currentTime)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                value={Math.min(currentTime, duration || currentTime)}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (videoRef.current) videoRef.current.currentTime = next;
                  setCurrentTime(next);
                }}
              />
              <span>-{formatTime(Math.max(0, duration - currentTime))}</span>
            </div>
            <div className="controlStrip">
              <div className="controlCluster">
                <button type="button" className="iconButton primary" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
                  {playing ? <Pause size={20} /> : <Play size={20} />}
                </button>
                <Volume2 size={18} />
                <input
                  className="volumeSlider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                />
              </div>
              <div className="controlCluster">
                <button type="button" className="iconButton" onClick={cycleSubtitles} title="Subtitles">
                  <Subtitles size={19} />
                </button>
                <button type="button" className="iconButton" onClick={() => setSettingsOpen((open) => !open)} title="Playback options">
                  <Settings size={19} />
                </button>
              </div>
            </div>

            {settingsOpen && (
              <div className="playerSettingsPanel">
                <div className="playerSettingGroup">
                  <strong>Subtitles</strong>
                  <button
                    type="button"
                    className={selectedSubtitleId === 'off' ? 'settingOption active' : 'settingOption'}
                    onClick={() => setSelectedSubtitleId('off')}
                  >
                    <span>Off</span>
                    {selectedSubtitleId === 'off' && <Check size={15} />}
                  </button>
                  {allSubtitleTracks.map((track) => (
                    <button
                      key={track.id}
                      type="button"
                      className={selectedSubtitleId === track.id ? 'settingOption active' : 'settingOption'}
                      onClick={() => setSelectedSubtitleId(track.id)}
                    >
                      <span>{track.label}</span>
                      <small>{track.language.toUpperCase()} - {track.provider}</small>
                      {selectedSubtitleId === track.id && <Check size={15} />}
                    </button>
                  ))}
                  <p>{subtitleStatus}</p>
                </div>

                <div className="playerSettingGroup">
                  <strong>Audio</strong>
                  {audioTracks.length === 0 ? (
                    <p>
                      {embeddedAudioTracksLikely
                        ? 'Embedded audio tracks are likely. Use the app player if Chromium does not expose them here.'
                        : 'Default audio only. Some MKV audio tracks require the desktop player.'}
                    </p>
                  ) : (
                    audioTracks.map((track) => (
                      <button
                        key={track.id}
                        type="button"
                        className={selectedAudioTrackId === track.id ? 'settingOption active' : 'settingOption'}
                        onClick={() => setSelectedAudioTrackId(track.id)}
                      >
                        <span>{track.label}</span>
                        <small>{track.language.toUpperCase()}</small>
                        {selectedAudioTrackId === track.id && <Check size={15} />}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="videoFallback">
          <p>
            This stream could not play in your browser
            {container ? ` (${container.toUpperCase()})` : ''}.
          </p>
          <p className="hint">
            MKV and some codecs need the desktop player. Selected subtitles will be passed along when possible.
          </p>
          <div className="videoFallbackActions">
            <button type="button" onClick={() => void copyLink()}>
              {copied ? 'Copied!' : 'Copy RealDebrid URL'}
            </button>
            {desktopPlayerAvailable && (
              <button type="button" onClick={() => void playInDesktopPlayer()}>
                Play in App Player
              </button>
            )}
            {externalUrl && (
              <a href={externalUrl} target="_blank" rel="noreferrer">
                Open direct link
              </a>
            )}
          </div>
          {desktopError && <p className="hint">{desktopError}</p>}
        </div>
      )}

      <div className="videoMeta">
        {quality && <span>{quality}</span>}
        {container && <span>{container.toUpperCase()}</span>}
        {selectedSubtitle && <span>{selectedSubtitle.language.toUpperCase()} subtitles</span>}
        {embeddedSubtitlesLikely && <span>Embedded subs likely</span>}
        {embeddedAudioTracksLikely && <span>Embedded audio likely</span>}
        {likelyUnsupported && !playbackError && (
          <span className="warn">MKV - use app player if browser playback fails</span>
        )}
        {filename && <span className="filename">{filename}</span>}
        {desktopPlayerAvailable && (
          <button type="button" className="inlinePlayerButton" onClick={() => void playInDesktopPlayer()}>
            Open fallback player
          </button>
        )}
      </div>
      {desktopError && !playbackError && <div className="videoMeta"><span className="warn">{desktopError}</span></div>}
    </div>
  );
}
