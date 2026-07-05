# Always-On iPhone Setup

The current iPhone wrapper can build, but it points at the Windows LAN test server by default:

`http://192.168.0.250:3010`

For an app that opens without your Windows PC running, the mobile web app and backend API need public HTTPS URLs.

## What needs to be hosted

1. `server`
   - Runs the Anime Hub API.
   - Talks to RealDebrid.
   - Handles stream resolving, HLS/transcoding, subtitles, and playback proxy routes.

2. `mobile-port`
   - Runs the mobile-friendly Anime Hub web UI.
   - Must be built with `NEXT_PUBLIC_API_URL` pointing at the hosted API.

## Recommended shape

- Host `server` on an always-on Node/Docker host.
- Host `mobile-port` on a Next.js host.
- Rebuild the IPA with `CAPACITOR_SERVER_URL` set to the hosted mobile web URL.

Example production values:

```text
NEXT_PUBLIC_API_URL=https://anime-api.example.com
CAPACITOR_SERVER_URL=https://anime-mobile.example.com
```

## Why this is needed

An IPA can live on your iPhone, but RealDebrid streaming cannot be fully self-contained in the app without exposing private credentials and losing the server-side stream/transcode logic. The backend needs to run somewhere. If the Windows PC is off, that somewhere has to be a cloud server.

## Free Apple ID IPA flow after hosting

1. Deploy `server` and `mobile-port`.
2. Set `NEXT_PUBLIC_API_URL` on the mobile web host.
3. Set `CAPACITOR_SERVER_URL` in Codemagic before running `Anime Hub Free Sideload Package`.
4. Download `AnimeHub-unsigned.ipa`.
5. Install it with Sideloadly.

Free Apple ID installs usually need to be refreshed about every 7 days.
