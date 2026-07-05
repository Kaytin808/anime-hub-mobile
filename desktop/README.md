# Anime Hub Desktop

Run the local desktop shell:

```bash
npm install
npm run desktop:dev
```

This starts:

- Fastify API on `http://localhost:4001`
- Next UI on `http://localhost:3000`
- Electron desktop window pointed at the UI

The next player milestone is MPV integration through Electron IPC, so streams can play with desktop-grade codec, subtitle, and audio-track support inside the app shell.
