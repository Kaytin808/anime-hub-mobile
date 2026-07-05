import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import VideoPlayer from '../components/VideoPlayer';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function TestPlayerPage() {
  return (
    <main className="testPlayerPage">
      <div className="testPlayerTop">
        <Link href="/" className="detailBack testPlayerBack" title="Back">
          <ArrowLeft size={22} />
        </Link>
        <div>
          <h1>Playback Test</h1>
          <p>Mobile player smoke test</p>
        </div>
      </div>

      <div className="testStatusPanel">
        <span>Ready: backend playback proxy is loaded.</span>
      </div>

      <section className="cinemaPlayer testCinemaPlayer">
        <VideoPlayer
          playbackUrl={`${API_URL}/streams/test-video`}
          directUrl={`${API_URL}/streams/test-video`}
          container="mp4"
          quality="720p"
          filename="anime-hub-mobile-playback-test.mp4"
          title="Anime Hub Mobile"
          episodeTitle="Playback Test"
          showId={999999}
          showTitle="Anime Hub Mobile"
          seasonNumber={1}
          episodeNumber={1}
          runtime={1}
        />
      </section>
    </main>
  );
}
