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
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#07111f" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Anime Hub" />
        <meta name="description" content="Mobile anime streaming via RealDebrid" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon.svg" />
        <title>Anime Hub Mobile</title>
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
