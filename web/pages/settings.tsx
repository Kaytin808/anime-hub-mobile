import { useEffect, useState } from 'react';

const PLAYBACK_MODE_KEY = 'animeHub.playbackMode';

type PlaybackMode = 'subbed' | 'dubbed';

export default function SettingsPage() {
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('subbed');

  useEffect(() => {
    const savedMode = window.localStorage.getItem(PLAYBACK_MODE_KEY);
    setPlaybackMode(savedMode === 'dubbed' ? 'dubbed' : 'subbed');
  }, []);

  function updatePlaybackMode(mode: PlaybackMode) {
    setPlaybackMode(mode);
    window.localStorage.setItem(PLAYBACK_MODE_KEY, mode);
  }

  return (
    <main className="settingsPage">
      <section className="settingsSection">
        <div className="settingsHeader">
          <h1>Settings</h1>
          <p>Playback defaults apply the next time a video starts.</p>
        </div>

        <div className="settingsGroup">
          <div>
            <h2>Audio Preference</h2>
            <p>Choose how mpv should auto-select tracks inside MKV releases.</p>
          </div>

          <div className="segmentedControl" role="group" aria-label="Playback audio preference">
            <button
              type="button"
              className={playbackMode === 'subbed' ? 'active' : ''}
              onClick={() => updatePlaybackMode('subbed')}
            >
              <span>Subbed</span>
              <small>Japanese audio, English subtitles</small>
            </button>
            <button
              type="button"
              className={playbackMode === 'dubbed' ? 'active' : ''}
              onClick={() => updatePlaybackMode('dubbed')}
            >
              <span>Dubbed</span>
              <small>English audio, subtitles hidden</small>
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
