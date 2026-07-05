import type { AppProps } from 'next/app';
import '../styles/globals.css';
import { RealDebridProvider } from '../context/RealDebridContext';
import Layout from '../components/Layout';
import Head from 'next/head';
import { useRouter } from 'next/router';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const isInternalPlayerRoute = router.pathname === '/internal-player';

  return (
    <>
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0f1115" />
        <meta name="description" content="Stremio-style anime streaming via RealDebrid" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        <title>Anime Hub</title>
      </Head>
      <RealDebridProvider>
        {isInternalPlayerRoute ? (
          <Component {...pageProps} />
        ) : (
          <Layout>
            <Component {...pageProps} />
          </Layout>
        )}
      </RealDebridProvider>
    </>
  );
}
