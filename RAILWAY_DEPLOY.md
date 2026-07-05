# Railway Deploy Notes

Deploy this repo as two Railway services from the same GitHub repository.

## Service 1: Backend API

- Root directory: `server`
- Build: Dockerfile
- Health check: `/health`
- Public URL needed: yes

Set these variables if needed:

```text
RD_USER_TOKEN=
PORT=
```

Railway supplies `PORT`, so normally leave it unset.

After deploy, test:

```text
https://your-api.up.railway.app/health
```

## Service 2: Mobile Web

- Root directory: `mobile-port`
- Build: Nixpacks / Node
- Public URL needed: yes

Set this variable:

```text
NEXT_PUBLIC_API_URL=https://your-api.up.railway.app
```

After deploy, open:

```text
https://your-mobile.up.railway.app
```

## Rebuild IPA

After both Railway URLs work, set this Codemagic environment variable for the IPA workflow:

```text
CAPACITOR_SERVER_URL=https://your-mobile.up.railway.app
```

Then run:

`Anime Hub Free Sideload Package`

Download the new `AnimeHub-unsigned.ipa` and install it with Sideloadly.
