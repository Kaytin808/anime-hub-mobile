const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const isPackaged = app.isPackaged;
const WEB_PORT = Number(process.env.WEB_PORT || 3000);
const API_PORT = Number(process.env.API_PORT || 4001);
const APP_URL = process.env.ELECTRON_START_URL || `http://127.0.0.1:${WEB_PORT}`;
const CHROME_HEADER_HEIGHT = 68;
const CHROME_CONTROLS_HEIGHT = 96;
const USE_MPVJS = process.env.USE_MPVJS === 'true';

const PLAYBACK_PREFERENCES = {
  subbed: {
    audio: 'jpn,jp,ja,japanese,eng,en,english',
    subtitles: 'eng,en,enm,english',
    subtitlesVisible: true
  },
  dubbed: {
    audio: 'eng,en,english,jpn,jp,ja,japanese',
    subtitles: 'eng,en,enm,english',
    subtitlesVisible: false
  }
};

if (process.platform === 'win32' && !USE_MPVJS) {
  app.disableHardwareAcceleration();
} else {
  app.commandLine.appendSwitch('disable-low-res-tiling');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('num-raster-threads', '4');
}

let mpvJsEnabled = false;

if (USE_MPVJS) {
  try {
    const { getPluginEntry } = require('mpv.js');
    const pluginDir = path.join(path.dirname(require.resolve('mpv.js')), 'build', 'Release');
    if (process.platform !== 'linux') {
      process.chdir(pluginDir);
    }
    app.commandLine.appendSwitch('ignore-gpu-blacklist');
    app.commandLine.appendSwitch('register-pepper-plugins', getPluginEntry(pluginDir));
    mpvJsEnabled = true;
  } catch (error) {
    mpvJsEnabled = false;
  }
}

let mainWindow;
let playerWindow;
let playerHeaderWindow;
let playerControlsWindow;
let mpvProcess;
let mpvIpcClient;
let mpvIpcBuffer = '';
let mpvPollInterval;
let mpvTrackPollTick = 0;
let mpvSocketPath = '';
let mpvRequestId = 0;
let mpvLastExit = '';
let playerUsesMainWindow = false;
let playerReturnUrl = APP_URL;
let bundledServerProcess = null;
let bundledWebProcess = null;
let restoreMainOpacityTimer = null;

let playerState = {
  title: 'Anime Hub Player',
  duration: 0,
  currentTime: 0,
  paused: false,
  subtitleVisible: true,
  subtitleTrackId: null,
  audioTrackId: null,
  trackList: [],
  playbackUrl: '',
  filename: '',
  lastError: ''
};

function logDesktopStartup(message, error) {
  const detail = error ? ` ${error.stack || error.message || String(error)}` : '';
  try {
    fs.appendFileSync(path.join(__dirname, 'desktop-startup.log'), `[${new Date().toISOString()}] ${message}${detail}\n`);
  } catch (_error) {
    // Startup logging should never block the desktop app.
  }

  try {
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd();
    const logDir = path.join(appData, 'Anime Hub', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'desktop-startup.log'), `[${new Date().toISOString()}] ${message}${detail}\n`);
  } catch (_error) {
    // Secondary startup logging should never block the desktop app.
  }
}

function logMpv(message, error) {
  const detail = error ? ` ${error.stack || error.message || String(error)}` : '';
  const line = `[${new Date().toISOString()}] ${message}${detail}\n`;
  try {
    fs.appendFileSync(path.join(__dirname, 'mpv-debug.log'), line);
  } catch (_error) {
    // MPV logging should never block playback flow.
  }

  try {
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd();
    const logDir = path.join(appData, 'Anime Hub', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'mpv-debug.log'), line);
  } catch (_error) {
    // Secondary MPV logging should never block playback flow.
  }
}

function logPlayerFlow(message, error) {
  const detail = error ? ` ${error.stack || error.message || String(error)}` : '';
  const line = `[${new Date().toISOString()}] ${message}${detail}\n`;
  try {
    fs.appendFileSync(path.join(__dirname, 'player-flow.log'), line);
  } catch (_error) {
    // Player flow logging should never block playback flow.
  }

  try {
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd();
    const logDir = path.join(appData, 'Anime Hub', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'player-flow.log'), line);
  } catch (_error) {
    // Secondary player flow logging should never block playback flow.
  }
}

function appendRendererLog(message, details) {
  try {
    const serialized = details === undefined ? '' : ` ${JSON.stringify(details)}`;
    fs.appendFileSync(path.join(__dirname, 'player-renderer.log'), `[${new Date().toISOString()}] ${message}${serialized}\n`);
  } catch (_error) {
    // Renderer logging should never block playback flow.
  }
}

function resolvePlaybackPreference(value) {
  return value === 'dubbed' ? PLAYBACK_PREFERENCES.dubbed : PLAYBACK_PREFERENCES.subbed;
}

function resolvePlayerReturnUrl(returnTo, payload) {
  const showId = payload && (payload.showId || payload.id);
  const fallbackPath = showId ? `/anime/${encodeURIComponent(String(showId))}` : '/';
  const rawPath = typeof returnTo === 'string' && returnTo.trim() ? returnTo.trim() : fallbackPath;
  let pathOnly = rawPath;

  try {
    if (/^https?:\/\//i.test(rawPath)) {
      const parsed = new URL(rawPath);
      pathOnly = `${parsed.pathname}${parsed.search || ''}${parsed.hash || ''}`;
    }
  } catch (_error) {
    pathOnly = fallbackPath;
  }

  if (!pathOnly.startsWith('/')) {
    pathOnly = `/${pathOnly}`;
  }

  if (
    !pathOnly ||
    pathOnly.includes('[id]') ||
    pathOnly.includes('undefined') ||
    pathOnly.includes('null') ||
    /^\/anime\/(?:\[id\]|undefined|null)(?:[/?#]|$)/i.test(pathOnly)
  ) {
    pathOnly = fallbackPath;
  }

  return `${APP_URL.replace(/\/$/, '')}${pathOnly}`;
}

function resolveBundledMpvPath() {
  const candidates = [
    process.env.MPV_PATH,
    path.join(process.resourcesPath, '.desktop-bundle', 'desktop', 'bin', 'mpv.exe'),
    path.join(__dirname, 'bin', 'mpv.exe'),
    path.join(__dirname, 'vendor', 'mpv', 'mpv.exe'),
    path.join(process.cwd(), 'desktop', 'bin', 'mpv.exe'),
    path.join(process.cwd(), 'desktop', 'vendor', 'mpv', 'mpv.exe'),
    'mpv'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'mpv') {
      return candidate;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'mpv';
}

function nativeWindowId(window) {
  const handle = window.getNativeWindowHandle();
  if (process.platform === 'win32' && handle.length >= 8) {
    return handle.readBigUInt64LE(0).toString();
  }
  return handle.readUInt32LE(0).toString();
}

function getMpvScriptArgs() {
  const scriptDirs = [
    path.join(process.resourcesPath, '.desktop-bundle', 'desktop', 'mpv', 'scripts'),
    path.join(process.cwd(), 'desktop', 'mpv', 'scripts'),
    path.join(process.cwd(), 'desktop', 'scripts', 'mpv')
  ];

  if (!__dirname.includes('app.asar')) {
    scriptDirs.push(
      path.join(__dirname, 'mpv', 'scripts'),
      path.join(__dirname, 'scripts', 'mpv')
    );
  }

  const args = [];
  const seen = new Set();

  for (const dir of scriptDirs) {
    if (!fs.existsSync(dir)) continue;

    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      if (seen.has(fullPath)) continue;
      if (!fs.statSync(fullPath).isFile()) continue;
      if (!/\.(lua|js|mjs|dll)$/i.test(entry)) continue;

      seen.add(fullPath);
      args.push(`--script=${fullPath}`);
    }
  }

  return args;
}

function waitForHttp(url, attempts = 80) {
  return new Promise((resolve, reject) => {
    const tryRequest = async (remaining) => {
      try {
        const response = await fetch(url, { method: 'GET' });
        if (response.ok) {
          resolve();
          return;
        }
      } catch (_error) {
        // Retry below.
      }

      if (remaining <= 0) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }

      setTimeout(() => {
        void tryRequest(remaining - 1);
      }, 500);
    };

    void tryRequest(attempts);
  });
}

function spawnBundledNode(scriptPath, cwd, extraEnv = {}) {
  const nodeRuntimeCandidates = [
    process.env.NODE_RUNTIME_PATH,
    process.platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : '',
    process.execPath
  ].filter(Boolean);
  const nodeRuntime = nodeRuntimeCandidates.find((candidate) => fs.existsSync(candidate)) || process.execPath;
  const env = {
    ...process.env,
    ...extraEnv,
    NODE_ENV: 'production'
  };

  if (nodeRuntime === process.execPath) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }

  const child = spawn(nodeRuntime, [scriptPath], {
    cwd,
    windowsHide: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout?.on('data', (chunk) => {
    logDesktopStartup(chunk.toString().trim());
  });

  child.stderr?.on('data', (chunk) => {
    logDesktopStartup(chunk.toString().trim());
  });

  child.on('error', (error) => {
    logDesktopStartup(`bundled child process error ${scriptPath}`, error);
  });

  return child;
}

async function ensureBundledServices() {
  if (!isPackaged) {
    return;
  }

  if (bundledServerProcess && bundledWebProcess) {
    return;
  }

  const resourcesRoot = path.join(process.resourcesPath, '.desktop-bundle');
  const serverRoot = path.join(resourcesRoot, 'server');
  const webRoot = path.join(resourcesRoot, 'web');
  const serverEntry = path.join(serverRoot, 'build', 'index.js');
  const webEntry = path.join(webRoot, 'server.js');

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Missing packaged API entry: ${serverEntry}`);
  }

  if (!fs.existsSync(webEntry)) {
    throw new Error(`Missing packaged web entry: ${webEntry}`);
  }

  bundledServerProcess = spawnBundledNode(serverEntry, serverRoot, {
    PORT: String(API_PORT)
  });

  bundledWebProcess = spawnBundledNode(webEntry, webRoot, {
    PORT: String(WEB_PORT),
    HOSTNAME: '127.0.0.1'
  });

  await Promise.all([
    waitForHttp(`http://127.0.0.1:${API_PORT}/anime/trending`),
    waitForHttp(`http://127.0.0.1:${WEB_PORT}/`)
  ]);
}

function stopBundledServices() {
  for (const child of [bundledWebProcess, bundledServerProcess]) {
    if (child && !child.killed) {
      child.kill();
    }
  }

  bundledWebProcess = null;
  bundledServerProcess = null;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function resolveTrackLabel(type, id) {
  const track = Array.isArray(playerState.trackList)
    ? playerState.trackList.find((item) => item && item.type === type && item.id === id)
    : null;

  if (!track) {
    return type === 'sub' ? 'Subtitles' : 'Audio';
  }

  return track.title || track.lang || `${type === 'sub' ? 'Subtitle' : 'Audio'} ${id}`;
}

function broadcastPlayerState() {
  const snapshot = {
    ...playerState,
    timeLabel: formatTime(playerState.currentTime),
    durationLabel: formatTime(playerState.duration),
    subtitleLabel: playerState.subtitleTrackId ? resolveTrackLabel('sub', playerState.subtitleTrackId) : 'Off',
    audioLabel: playerState.audioTrackId ? resolveTrackLabel('audio', playerState.audioTrackId) : 'Default'
  };

  if (playerHeaderWindow && !playerHeaderWindow.isDestroyed()) {
    playerHeaderWindow.webContents.send('desktop-player:state', snapshot);
  }
  if (playerControlsWindow && !playerControlsWindow.isDestroyed()) {
    playerControlsWindow.webContents.send('desktop-player:state', snapshot);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop-player:state', snapshot);
  }
}

function patchPlayerState(patch) {
  playerState = {
    ...playerState,
    ...patch
  };
  broadcastPlayerState();
}

function stopMpvIpc() {
  if (mpvPollInterval) {
    clearInterval(mpvPollInterval);
    mpvPollInterval = null;
  }

  if (mpvIpcClient) {
    mpvIpcClient.destroy();
    mpvIpcClient = null;
  }

  mpvIpcBuffer = '';
  mpvSocketPath = '';
}

function stopMpv() {
  stopMpvIpc();
  if (mpvProcess && !mpvProcess.killed) {
    mpvProcess.kill();
  }
  mpvProcess = null;
}

function closePlayerChrome() {
  const windows = [playerHeaderWindow, playerControlsWindow];
  playerHeaderWindow = null;
  playerControlsWindow = null;

  for (const win of windows) {
    if (win && !win.isDestroyed()) {
      win.close();
    }
  }
}

function hidePlayerChrome() {
  const windows = [playerHeaderWindow, playerControlsWindow];
  for (const win of windows) {
    if (win && !win.isDestroyed()) {
      win.hide();
    }
  }
}

function hasActivePlayer() {
  return Boolean(playerWindow && !playerWindow.isDestroyed());
}

function isAnimeHubFocused() {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  return Boolean(
    focusedWindow &&
    (focusedWindow === mainWindow ||
      focusedWindow === playerWindow ||
      focusedWindow === playerHeaderWindow ||
      focusedWindow === playerControlsWindow)
  );
}

function setMainWindowPlaybackHidden(hidden) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (restoreMainOpacityTimer) {
    clearTimeout(restoreMainOpacityTimer);
    restoreMainOpacityTimer = null;
  }

  mainWindow.setOpacity(hidden ? 0 : 1);
}

function restorePlayerSurfaceAfterMinimize() {
  if (!hasActivePlayer()) {
    setMainWindowPlaybackHidden(false);
    return;
  }

  if (playerWindow.isMinimized()) {
    playerWindow.restore();
  }
  if (!playerWindow.isVisible()) {
    playerWindow.showInactive();
  }

  syncChromeBounds();
  playerWindow.moveTop();
  playerWindow.focus();
  showPlayerChrome();

  restoreMainOpacityTimer = setTimeout(() => {
    setMainWindowPlaybackHidden(false);
  }, 250);
}

function showPlayerChrome() {
  if (!playerWindow || playerWindow.isDestroyed() || playerWindow.isMinimized() || !isAnimeHubFocused()) return;

  syncChromeBounds();
  const windows = [playerHeaderWindow, playerControlsWindow];
  for (const win of windows) {
    if (win && !win.isDestroyed()) {
      win.showInactive();
    }
  }
}

function createEmbeddedPlayerHtml(payload) {
  const data = JSON.stringify({
    url: payload.url,
    title: payload.title || 'Anime Hub Player',
    subtitleUrl: payload.subtitleUrl || ''
  }).replace(/</g, '\\u003c');

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#02070d;color:#dff7ff;font-family:Segoe UI,Arial,sans-serif}
          #stage{position:fixed;inset:0;background:#02070d}
          embed{width:100%;height:100%;display:block}
          .overlay{position:fixed;left:0;right:0;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 18px;pointer-events:none;opacity:0;transition:opacity .18s ease}
          body:hover .overlay{opacity:1}
          .top{top:0;background:linear-gradient(180deg,rgba(0,0,0,.72),transparent)}
          .bottom{bottom:0;background:linear-gradient(0deg,rgba(0,0,0,.82),transparent)}
          .title{font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          .hint{position:fixed;inset:0;display:grid;place-items:center;text-align:center;background:linear-gradient(135deg,#02070d,#071827);color:#9edfff}
          .chip{border:1px solid rgba(126,211,255,.22);background:rgba(14,31,52,.78);border-radius:999px;padding:8px 12px;font-size:12px}
        </style>
      </head>
      <body>
        <div id="stage">
          <embed id="mpv" type="application/x-mpvjs" />
        </div>
        <div id="fallback" class="hint">Starting embedded player...</div>
        <div class="overlay top"><div class="title" id="title"></div><div class="chip">Embedded mpv</div></div>
        <div class="overlay bottom"><div class="chip">Space: Play/Pause</div><div class="chip">S: Subs · A: Audio · F: Fullscreen</div></div>
        <script>
          const payload = ${data};
          const mpv = document.getElementById('mpv');
          const fallback = document.getElementById('fallback');
          document.getElementById('title').textContent = payload.title;

          function command(name, ...args) {
            mpv.postMessage({ type: 'command', data: [name, ...args.map(String)] });
          }

          mpv.addEventListener('message', (event) => {
            const message = event.data || {};
            if (message.type !== 'ready') return;
            fallback.style.display = 'none';
            command('loadfile', payload.url);
            if (payload.subtitleUrl) command('sub-add', payload.subtitleUrl, 'select');
          });

          window.addEventListener('keydown', (event) => {
            if (event.code === 'Space') {
              event.preventDefault();
              command('cycle', 'pause');
            }
            if (event.key.toLowerCase() === 's') command('cycle', 'sid');
            if (event.key.toLowerCase() === 'a') command('cycle', 'aid');
            if (event.key.toLowerCase() === 'f') document.documentElement.requestFullscreen?.();
            if (event.key === 'ArrowRight') command('seek', '10');
            if (event.key === 'ArrowLeft') command('seek', '-10');
          });

          setTimeout(() => {
            fallback.textContent = 'Embedded mpv is still starting. If this stays here, the libmpv DLL is still not loading.';
          }, 5000);
        </script>
      </body>
    </html>
  `;
}

function createMpvJsPlayerWindow(payload) {
  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.focus();
    playerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createEmbeddedPlayerHtml(payload))}`);
    return playerWindow;
  }

  playerWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    transparent: true,
    backgroundColor: '#00000000',
    title: payload.title || 'Anime Hub Player',
    autoHideMenuBar: true,
    webPreferences: {
      plugins: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  playerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createEmbeddedPlayerHtml(payload))}`);

  playerWindow.on('closed', () => {
    playerWindow = null;
  });

  return playerWindow;
}

function syncChromeBounds() {
  if (!playerWindow || playerWindow.isDestroyed()) return;

  const bounds = playerWindow.getBounds();
  if (playerHeaderWindow && !playerHeaderWindow.isDestroyed()) {
    playerHeaderWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: CHROME_HEADER_HEIGHT
    });
  }

  if (playerControlsWindow && !playerControlsWindow.isDestroyed()) {
    playerControlsWindow.setBounds({
      x: bounds.x,
      y: bounds.y + bounds.height - CHROME_CONTROLS_HEIGHT,
      width: bounds.width,
      height: CHROME_CONTROLS_HEIGHT
    });
  }
}

function createChromeWindow(surface) {
  const win = new BrowserWindow({
    width: 1280,
    height: surface === 'header' ? CHROME_HEADER_HEIGHT : CHROME_CONTROLS_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: false,
    parent: playerWindow,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'player-chrome-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  win.loadFile(path.join(__dirname, 'player-chrome.html'), {
    query: { surface }
  });

  win.once('ready-to-show', () => {
    syncChromeBounds();
    win.showInactive();
    broadcastPlayerState();
  });

  return win;
}

function attachPlayerWindowEvents() {
  if (!playerWindow) return;

  const sync = () => syncChromeBounds();
  playerWindow.on('move', sync);
  playerWindow.on('resize', sync);
  playerWindow.on('enter-full-screen', sync);
  playerWindow.on('leave-full-screen', sync);
  playerWindow.on('focus', () => {
    showPlayerChrome();
  });
  playerWindow.on('blur', () => {
    setTimeout(() => {
      if (!isAnimeHubFocused()) hidePlayerChrome();
    }, 80);
  });
  playerWindow.on('minimize', hidePlayerChrome);
  playerWindow.on('hide', hidePlayerChrome);
  playerWindow.on('restore', restorePlayerSurfaceAfterMinimize);
  playerWindow.on('show', restorePlayerSurfaceAfterMinimize);
}

function createPlayerWindow(title) {
  logPlayerFlow(`createPlayerWindow ${title || 'Anime Hub Player'}`);
  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.setTitle(title || 'Anime Hub Player');
    playerWindow.focus();
    return playerWindow;
  }

  const parentBounds = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.getBounds()
    : { x: undefined, y: undefined, width: 1280, height: 720 };

  playerUsesMainWindow = false;
  playerWindow = new BrowserWindow({
    width: parentBounds.width,
    height: parentBounds.height,
    minWidth: 960,
    minHeight: 540,
    x: parentBounds.x,
    y: parentBounds.y,
    frame: false,
    skipTaskbar: true,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    backgroundColor: '#02070d',
    title: title || 'Anime Hub Player',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  playerWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            html,body{
              margin:0;
              width:100%;
              height:100%;
              overflow:hidden;
              background:transparent;
              font-family:Segoe UI,Arial,sans-serif;
            }
            .stage{
              position:fixed;
              inset:0;
              background:transparent;
              pointer-events:none;
            }
          </style>
        </head>
        <body>
          <div class="stage"></div>
        </body>
      </html>
    `)}`
  );

  playerWindow.on('closed', () => {
    closePlayerChrome();
    stopMpv();
    playerWindow = null;
    playerUsesMainWindow = false;
  });

  attachPlayerWindowEvents();

  return playerWindow;
}

function restoreMainWindowAfterPlayback() {
  logPlayerFlow('restoreMainWindowAfterPlayback');
  closePlayerChrome();
  stopMpv();
  setMainWindowPlaybackHidden(false);

  const returnUrl = playerReturnUrl || APP_URL;
  const win = playerWindow;
  playerWindow = null;
  playerUsesMainWindow = false;

  if (win && !win.isDestroyed() && win !== mainWindow) {
    win.close();
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle('Anime Hub');
    mainWindow.setBackgroundColor('#07111f');
    mainWindow.loadURL(returnUrl);
    mainWindow.focus();
  }
}

function closePlayerSurface() {
  logPlayerFlow('closePlayerSurface');
  closePlayerChrome();
  stopMpv();
  setMainWindowPlaybackHidden(false);

  const win = playerWindow;
  playerWindow = null;
  playerUsesMainWindow = false;

  if (win && !win.isDestroyed() && win !== mainWindow) {
    win.close();
  }
}

function ensurePlayerChrome() {
  if (!playerWindow || playerWindow.isDestroyed()) return;

  if (!playerHeaderWindow || playerHeaderWindow.isDestroyed()) {
    playerHeaderWindow = createChromeWindow('header');
  }
  if (!playerControlsWindow || playerControlsWindow.isDestroyed()) {
    playerControlsWindow = createChromeWindow('controls');
  }

  syncChromeBounds();
}

function sendMpvCommand(command, requestId) {
  if (!mpvIpcClient || !mpvIpcClient.writable) return false;
  const message = {
    command
  };
  if (requestId !== undefined) {
    message.request_id = requestId;
  }
  mpvIpcClient.write(`${JSON.stringify(message)}\n`);
  return true;
}

function handleMpvReply(message) {
  switch (message.request_id) {
    case 1:
      patchPlayerState({ paused: Boolean(message.data) });
      break;
    case 2:
      patchPlayerState({ currentTime: Number(message.data) || 0 });
      break;
    case 3:
      patchPlayerState({ duration: Number(message.data) || 0 });
      break;
    case 4:
      patchPlayerState({ audioTrackId: typeof message.data === 'number' ? message.data : null });
      break;
    case 5:
      patchPlayerState({ subtitleTrackId: typeof message.data === 'number' ? message.data : null });
      break;
    case 6:
      patchPlayerState({ subtitleVisible: message.data !== false });
      break;
    case 7:
      patchPlayerState({ trackList: Array.isArray(message.data) ? message.data : [] });
      break;
    default:
      break;
  }
}

function handleMpvMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (message.event === 'shutdown') {
    restoreMainWindowAfterPlayback();
    return;
  }

  if (message.request_id !== undefined) {
    handleMpvReply(message);
  }
}

function startMpvPolling() {
  if (mpvPollInterval) {
    clearInterval(mpvPollInterval);
  }

  const poll = () => {
    mpvTrackPollTick += 1;
    sendMpvCommand(['get_property', 'pause'], 1);
    sendMpvCommand(['get_property', 'time-pos'], 2);
    sendMpvCommand(['get_property', 'duration'], 3);
    sendMpvCommand(['get_property', 'aid'], 4);
    sendMpvCommand(['get_property', 'sid'], 5);
    sendMpvCommand(['get_property', 'sub-visibility'], 6);
    if (mpvTrackPollTick === 1 || mpvTrackPollTick % 4 === 0) {
      sendMpvCommand(['get_property', 'track-list'], 7);
    }
  };

  mpvTrackPollTick = 0;
  poll();
  mpvPollInterval = setInterval(poll, 500);
}

function connectToMpvIpc(socketPath, attempts = 60) {
  return new Promise((resolve, reject) => {
    const tryConnect = (remaining) => {
      const client = net.createConnection(socketPath);
      let settled = false;

      client.once('connect', () => {
        mpvIpcClient = client;
        mpvIpcBuffer = '';

        client.on('data', (chunk) => {
          mpvIpcBuffer += chunk.toString();
          let newlineIndex = mpvIpcBuffer.indexOf('\n');
          while (newlineIndex >= 0) {
            const line = mpvIpcBuffer.slice(0, newlineIndex).trim();
            mpvIpcBuffer = mpvIpcBuffer.slice(newlineIndex + 1);
            if (line) {
              handleMpvMessage(line);
            }
            newlineIndex = mpvIpcBuffer.indexOf('\n');
          }
        });

        client.on('error', (error) => {
          patchPlayerState({ lastError: error.message || 'MPV IPC connection error' });
        });

        client.on('close', () => {
          mpvIpcClient = null;
        });

        startMpvPolling();
        settled = true;
        resolve();
      });

      client.once('error', () => {
        client.destroy();
        if (settled) return;
        if (remaining <= 0) {
          reject(new Error(`Unable to connect to mpv IPC server.${mpvLastExit ? ` ${mpvLastExit}` : ''}`));
          return;
        }
        setTimeout(() => tryConnect(remaining - 1), 150);
      });
    };

    tryConnect(attempts);
  });
}

function createWindow() {
  logDesktopStartup('createWindow');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#07111f',
    title: 'Anime Hub',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      plugins: mpvJsEnabled,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !mpvJsEnabled,
      backgroundThrottling: false
    }
  });

  const showMainWindow = () => {
    logDesktopStartup('showMainWindow');
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  };

  mainWindow.once('ready-to-show', () => {
    logDesktopStartup('ready-to-show');
    showMainWindow();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    logDesktopStartup('did-finish-load');
    showMainWindow();
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logDesktopStartup(`did-fail-load ${validatedURL}: ${errorCode} ${errorDescription}`);
    console.error(`Main window failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });

  logDesktopStartup(`loadURL ${APP_URL}`);
  mainWindow.loadURL(APP_URL);
  setTimeout(showMainWindow, 3000);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.on('blur', () => {
    setTimeout(() => {
      if (!isAnimeHubFocused()) hidePlayerChrome();
    }, 80);
  });
  mainWindow.on('focus', showPlayerChrome);
  mainWindow.on('minimize', () => {
    hidePlayerChrome();
    if (hasActivePlayer()) setMainWindowPlaybackHidden(true);
  });
  mainWindow.on('hide', hidePlayerChrome);
  mainWindow.on('restore', restorePlayerSurfaceAfterMinimize);
  mainWindow.on('show', restorePlayerSurfaceAfterMinimize);
}

function openInternalPlayerRoute(payload) {
  logPlayerFlow(`openInternalPlayerRoute ${payload?.playerBackend || 'auto'}`);
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }

  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const nextUrl = `${APP_URL.replace(/\/$/, '')}/internal-player?data=${encodeURIComponent(encoded)}`;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    void mainWindow.loadURL(nextUrl);
  }

  return nextUrl;
}

function waitForMainWindowLoad() {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      resolve();
      return;
    }

    if (!mainWindow.webContents.isLoading()) {
      resolve();
      return;
    }

    mainWindow.webContents.once('did-finish-load', () => resolve());
  });
}

function canLaunchMpv(mpvPath) {
  if (mpvPath !== 'mpv') {
    return fs.existsSync(mpvPath);
  }

  return true;
}

async function startInlineMpv(targetWindow, url, playbackPreference, subtitleUrl, resumeTime = 0) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    throw new Error('Player window is not available');
  }

  stopMpv();
  mpvLastExit = '';

  mpvSocketPath = `\\\\.\\pipe\\anime-hub-mpv-${Date.now()}`;
  const mpvPath = resolveBundledMpvPath();
  const windowId = nativeWindowId(targetWindow);
  const mpvLogFile = (() => {
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd();
    const logDir = path.join(appData, 'Anime Hub', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    return path.join(logDir, 'mpv-process.log');
  })();

  if (!canLaunchMpv(mpvPath)) {
    throw new Error('mpv is not installed. Place mpv.exe in desktop/bin or install mpv on PATH.');
  }

  const args = [
    '--no-config',
    '--msg-level=all=debug',
    `--log-file=${mpvLogFile}`,
    `--wid=${windowId}`,
    '--vo=gpu',
    '--gpu-context=d3d11',
    '--gpu-api=d3d11',
    '--force-window=immediate',
    '--no-window-dragging',
    '--keep-open=no',
    '--osc=no',
    '--idle=no',
    '--input-default-bindings=yes',
    '--keep-open-pause=no',
    '--sub-auto=all',
    `--sub-visibility=${playbackPreference.subtitlesVisible ? 'yes' : 'no'}`,
    '--aid=auto',
    '--sid=auto',
    '--audio-file-auto=fuzzy',
    `--alang=${playbackPreference.audio}`,
    `--slang=${playbackPreference.subtitles}`,
    '--sub-fix-timing=yes',
    '--demuxer-mkv-subtitle-preroll=yes',
    '--demuxer-lavf-o=scan_all_pmts=1',
    `--input-ipc-server=${mpvSocketPath}`,
    ...getMpvScriptArgs(),
    ...(subtitleUrl ? [`--sub-file=${subtitleUrl}`] : []),
    ...(resumeTime > 5 ? [`--start=${Math.floor(resumeTime)}`] : []),
    url
  ];

  logMpv(`spawn cwd=${process.cwd()} windowId=${windowId} mpv=${mpvPath} ${args.join(' ')}`);

  mpvProcess = spawn(mpvPath, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  mpvProcess.stdout?.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (!text) return;
    logMpv(`stdout ${text}`);
  });

  mpvProcess.stderr?.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (!text) return;
    logMpv(`stderr ${text}`);
    patchPlayerState({ lastError: text });
  });

  mpvProcess.on('error', (error) => {
    logMpv('process error', error);
    patchPlayerState({ lastError: error.message || 'Unable to start mpv' });
    stopMpv();
  });

  mpvProcess.on('exit', (code, signal) => {
    mpvLastExit = `mpv exited code=${code ?? 'null'} signal=${signal ?? 'null'}`;
    logMpv(mpvLastExit);
    stopMpvIpc();
    mpvProcess = null;
  });

  await connectToMpvIpc(mpvSocketPath);
  sendMpvCommand(['set_property', 'options/alang', playbackPreference.audio]);
  sendMpvCommand(['set_property', 'options/slang', playbackPreference.subtitles]);
  sendMpvCommand(['set_property', 'sub-visibility', playbackPreference.subtitlesVisible ? 'yes' : 'no']);
  sendMpvCommand(['set_property', 'sid', 'auto']);
  sendMpvCommand(['set_property', 'aid', 'auto']);
  if (resumeTime > 5) {
    sendMpvCommand(['seek', String(Math.floor(resumeTime)), 'absolute+exact']);
    patchPlayerState({ currentTime: resumeTime });
  }
}

ipcMain.handle('desktop-player:play', async (_event, payload) => {
  const directUrl = payload && typeof payload.url === 'string' ? payload.url : '';
  const playbackUrl = payload && typeof payload.playbackUrl === 'string' ? payload.playbackUrl : '';
  const streamUrl = directUrl || playbackUrl;
  const title = payload && typeof payload.title === 'string' ? payload.title : 'Anime Hub Player';
  const subtitleUrl = payload && typeof payload.subtitleUrl === 'string' ? payload.subtitleUrl : '';
  const returnTo = payload && typeof payload.returnTo === 'string' ? payload.returnTo : '/';
  const playbackPreference = resolvePlaybackPreference(payload && payload.playbackMode);
  const resumeTime = Math.max(0, Number(payload && payload.resumeTime) || 0);

  if (!streamUrl) {
    return { ok: false, error: 'Missing stream URL' };
  }

  if (process.platform !== 'win32') {
    openInternalPlayerRoute({
      ...payload,
      url: directUrl || playbackUrl,
      playbackUrl,
      title,
      subtitleUrl,
      returnTo,
      playbackMode: payload?.playbackMode || 'subbed',
      playerBackend: 'html5'
    });
    return { ok: true, player: 'inline-html5' };
  }

  playerReturnUrl = resolvePlayerReturnUrl(returnTo, payload);
  logPlayerFlow(`playerReturnUrl ${playerReturnUrl}`);

  patchPlayerState({
    title,
    duration: 0,
    currentTime: resumeTime > 5 ? resumeTime : 0,
    paused: false,
    subtitleVisible: playbackPreference.subtitlesVisible,
    subtitleTrackId: null,
    audioTrackId: null,
    trackList: [],
    playbackUrl: streamUrl,
    filename: title,
    lastError: ''
  });

  try {
    const targetWindow = createPlayerWindow(title);
    ensurePlayerChrome();
    await startInlineMpv(targetWindow, streamUrl, playbackPreference, subtitleUrl, resumeTime);
    return { ok: true, player: 'inline-mpv' };
  } catch (error) {
    logPlayerFlow('mpv playback failed', error);
    patchPlayerState({
      lastError: error instanceof Error ? error.message : 'Unable to start mpv playback'
    });
    closePlayerSurface();

    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to start mpv playback'
    };
  }
});

ipcMain.handle('desktop-player:capabilities', async () => ({
  embedded: true,
  inline: true,
  popupFallback: false
}));

ipcMain.handle('desktop-player:log', async (_event, payload) => {
  const message = payload && typeof payload.message === 'string' ? payload.message : 'renderer-log';
  appendRendererLog(message, payload?.details);
  return { ok: true };
});

ipcMain.handle('desktop-player:control', async (_event, payload) => {
  const command = payload && typeof payload.command === 'string' ? payload.command : '';
  const value = payload ? payload.value : undefined;

  switch (command) {
    case 'toggle-pause':
      sendMpvCommand(['cycle', 'pause']);
      patchPlayerState({ paused: !playerState.paused });
      return { ok: true };
    case 'seek-relative':
      sendMpvCommand(['seek', String(Number(payload.value) || 0), 'relative']);
      patchPlayerState({
        currentTime: Math.max(0, Math.min(playerState.duration || Number.MAX_SAFE_INTEGER, (playerState.currentTime || 0) + (Number(payload.value) || 0)))
      });
      return { ok: true };
    case 'seek-absolute':
      sendMpvCommand(['seek', String(Number(payload.value) || 0), 'absolute+exact']);
      patchPlayerState({
        currentTime: Math.max(0, Math.min(playerState.duration || Number.MAX_SAFE_INTEGER, Number(payload.value) || 0))
      });
      return { ok: true };
    case 'cycle-subtitles':
      sendMpvCommand(['set_property', 'sub-visibility', 'yes']);
      sendMpvCommand(['cycle', 'sid']);
      patchPlayerState({ subtitleVisible: true });
      return { ok: true };
    case 'cycle-audio':
      sendMpvCommand(['cycle', 'aid']);
      return { ok: true };
    case 'set-audio-track':
      if (value === null || value === undefined || value === '' || value === 'auto') {
        sendMpvCommand(['set_property', 'aid', 'auto']);
        patchPlayerState({ audioTrackId: null });
      } else {
        sendMpvCommand(['set_property', 'aid', String(Number(value) || value)]);
        patchPlayerState({ audioTrackId: Number(value) || value });
      }
      return { ok: true };
    case 'set-subtitle-track':
      if (value === null || value === undefined || value === '' || value === 'no' || value === 'off') {
        sendMpvCommand(['set_property', 'sub-visibility', 'no']);
        sendMpvCommand(['set_property', 'sid', 'no']);
        patchPlayerState({ subtitleVisible: false, subtitleTrackId: null });
      } else if (value === 'auto') {
        sendMpvCommand(['set_property', 'sub-visibility', 'yes']);
        sendMpvCommand(['set_property', 'sid', 'auto']);
        patchPlayerState({ subtitleVisible: true, subtitleTrackId: null });
      } else {
        sendMpvCommand(['set_property', 'sub-visibility', 'yes']);
        sendMpvCommand(['set_property', 'sid', String(Number(value) || value)]);
        patchPlayerState({ subtitleVisible: true, subtitleTrackId: Number(value) || value });
      }
      return { ok: true };
    case 'toggle-fullscreen':
      if (playerWindow && !playerWindow.isDestroyed()) {
        playerWindow.setFullScreen(!playerWindow.isFullScreen());
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      }
      return { ok: true };
    case 'minimize-player':
      hidePlayerChrome();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
      } else if (playerWindow && !playerWindow.isDestroyed()) {
        playerWindow.minimize();
      }
      return { ok: true };
    case 'close-player':
      restoreMainWindowAfterPlayback();
      return { ok: true };
    default:
      return { ok: false, error: 'Unknown desktop player command' };
  }
});

function createMenu() {
  const template = [
    {
      label: 'Anime Hub',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  logDesktopStartup('app ready');
  createMenu();
  if (isPackaged) {
    try {
      await ensureBundledServices();
    } catch (error) {
      dialog.showErrorBox(
        'Anime Hub failed to start',
        error instanceof Error ? error.message : 'Unable to start bundled services.'
      );
      app.quit();
      return;
    }
  }
  createWindow();

  app.on('browser-window-blur', () => {
    setTimeout(() => {
      if (!isAnimeHubFocused()) hidePlayerChrome();
    }, 80);
  });

  app.on('browser-window-focus', () => {
    if (!hasActivePlayer()) return;

    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow === playerHeaderWindow || focusedWindow === playerControlsWindow || focusedWindow === playerWindow) {
      showPlayerChrome();
      return;
    }

    if (focusedWindow === mainWindow) {
      restorePlayerSurfaceAfterMinimize();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopBundledServices();
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBundledServices();
});
