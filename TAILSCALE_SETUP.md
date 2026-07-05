# Tailscale iPhone Setup

This is the free/private path.

## What must be running

- Your Windows PC must be on.
- Tailscale must be signed in on the PC.
- Tailscale must be signed in on the iPhone.
- Anime Hub backend and mobile server must be running on the PC.

Tailscale is the private network. The Anime Hub servers are still what actually serve the app and video.

## Install Tailscale

1. Install Tailscale on Windows.
2. Sign in.
3. Install Tailscale on iPhone from the App Store.
4. Sign in to the same Tailscale account.
5. Make sure the iPhone VPN toggle is connected.

## Start Anime Hub

Run:

```powershell
.\Start-AnimeHub-Mobile.ps1
```

The launcher prints URLs like:

```text
Phone app URL: http://100.x.y.z:3010
Backend URL:   http://100.x.y.z:4000
```

## Test on iPhone

Open Safari on the iPhone and visit:

```text
http://YOUR_TAILSCALE_IP:3010
```

If that loads, the IPA can be rebuilt to point at the same Tailscale URL.

## Rebuild IPA for Tailscale

In Codemagic, set:

```text
CAPACITOR_SERVER_URL=http://YOUR_TAILSCALE_IP:3010
```

Then run:

`Anime Hub Free Sideload Package`

Download `AnimeHub-unsigned.ipa` and install it with Sideloadly.

## Notes

- Free Apple ID sideloading usually needs refreshing about every 7 days.
- If your PC sleeps, the iPhone app cannot connect. Set Windows sleep to never while plugged in if needed.
- Tailscale itself is lightweight. Video transcoding is the part that can use noticeable CPU.
