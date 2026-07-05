import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRealDebrid } from '../context/RealDebridContext';

const PLAYBACK_MODE_KEY = 'animeHub.playbackMode';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

type PlaybackMode = 'subbed' | 'dubbed';

export default function SettingsPage() {
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('subbed');
  const [rdTestStatus, setRdTestStatus] = useState('');
  const [rdTesting, setRdTesting] = useState(false);
  const { token, status } = useRealDebrid();

  useEffect(() => {
    const savedMode = window.localStorage.getItem(PLAYBACK_MODE_KEY);
    setPlaybackMode(savedMode === 'dubbed' ? 'dubbed' : 'subbed');
  }, []);

  function updatePlaybackMode(mode: PlaybackMode) {
    setPlaybackMode(mode);
    window.localStorage.setItem(PLAYBACK_MODE_KEY, mode);
  }

  async function testRealDebrid() {
    try {
      setRdTesting(true);
      setRdTestStatus('');
      const res = await fetch(`${API_URL}/auth/realdebrid/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined
      });
      const data = await res.json();
      if (!res.ok || !data.connected) {
        throw new Error(data.error || 'RealDebrid is not connected');
      }

      const username = data.user?.username || data.user?.email || 'account';
      setRdTestStatus(`RealDebrid connected: ${username}`);
    } catch (err) {
      setRdTestStatus(err instanceof Error ? err.message : 'RealDebrid test failed');
    } finally {
      setRdTesting(false);
    }
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

        <div className="settingsGroup">
          <div>
            <h2>Playback Test</h2>
            <p>Open the mobile video player with a known MP4 test stream.</p>
          </div>

          <Link className="settingsActionButton" href="/test-player">
            Open Test Player
          </Link>
        </div>

        <div className="settingsGroup">
          <div>
            <h2>RealDebrid Test</h2>
            <p>Validate the RealDebrid connection from this mobile app.</p>
          </div>

          <div className="settingsActionStack">
            <button className="settingsActionButton" type="button" onClick={testRealDebrid} disabled={rdTesting}>
              {rdTesting ? 'Testing...' : 'Test RealDebrid'}
            </button>
            <p className={rdTestStatus.toLowerCase().includes('connected') ? 'settingsStatus good' : 'settingsStatus'}>
              {rdTestStatus || `Current status: ${status}`}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
