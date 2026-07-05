# Anime Hub

Stremio-style anime app powered by **TMDB metadata** and **RealDebrid** streaming. Torrents are discovered from indexers (Nyaa, AnimeTosho), checked against RealDebrid cache, and played via RD direct links — never downloaded locally.

## Features

- Trending anime, new episodes today, and currently airing shows
- Episode guide with season picker (TMDB)
- Auto-resolve: search torrent indexers → check RD cache → stream cached links
- Multiple torrent sources with clickable source picker
- RealDebrid device OAuth (connect from sidebar)
- Browser player with fallback for MKV/unsupported formats (copy link / open externally)

## Quick start

1. Copy env examples and set keys:

```bash
cp server/.env.example server/.env
cp web/.env.example web/.env
```

Set `TMDB_API_KEY` in `server/.env` ([free TMDB API key](https://www.themoviedb.org/settings/api)).

2. Install and run (two terminals):

```bash
cd server && npm install && npm run dev
cd web && npm install && npm run dev
```

3. Open `http://localhost:3000`, connect RealDebrid in the sidebar, pick an anime, and click an episode.

Or with Docker:

```bash
docker-compose up --build
```

## API overview

| Endpoint | Description |
|---|---|
| `GET /anime/trending` | Popular Japanese animation |
| `GET /anime/airing-today` | Episodes airing today |
| `GET /anime/on-the-air` | Currently airing season |
| `GET /anime/search?q=` | Search anime |
| `GET /anime/:id` | Show details + seasons |
| `GET /anime/:id/season/:n` | Episode list |
| `POST /streams/auto-resolve` | Search indexers + resolve best cached RD stream |
| `POST /streams/resolve` | Resolve magnet or hoster link via RD |
| `POST /auth/realdebrid/start` | Start device auth |
| `POST /auth/realdebrid/poll` | Poll for access token |

## RealDebrid notes

- Without a token, `/streams/resolve` returns a demo MP4 for testing UI only.
- For local dev, you can set `RD_USER_TOKEN` in `server/.env`.
- Production flow: user connects via device auth; token is stored in browser localStorage and sent with resolve requests.
- `onlyCached: true` ensures magnets are only resolved when already cached on RealDebrid (Stremio-style).
