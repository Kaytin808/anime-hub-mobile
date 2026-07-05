const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');
const { getPluginEntry } = require('mpv.js');

const pluginDir = path.join(path.dirname(require.resolve('mpv.js')), 'build', 'Release');
const logPath = path.join(process.cwd(), 'desktop', 'mpv-plugin-smoke.log');

function writeLog(value) {
  fs.appendFileSync(logPath, `${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
}

process.on('uncaughtException', (error) => {
  writeLog(error.stack || error.message || String(error));
  app.exit(1);
});

process.on('unhandledRejection', (error) => {
  writeLog(error && error.stack ? error.stack : String(error));
  app.exit(1);
});

writeLog('starting mpv plugin smoke');

if (process.platform !== 'linux') {
  process.chdir(pluginDir);
}

app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('register-pepper-plugins', getPluginEntry(pluginDir));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 640,
    height: 360,
    show: false,
    webPreferences: {
      plugins: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const html = `
    <!doctype html>
    <html>
      <body>
        <embed id="mpv" type="application/x-mpvjs" style="width:100%;height:100%" />
      </body>
    </html>
  `;

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const result = await win.webContents.executeJavaScript(`
    (() => {
      const plugin = document.getElementById('mpv');
      return {
        pluginRegistered: Array.from(navigator.plugins || []).map((item) => item.name),
        mimeRegistered: Boolean(navigator.mimeTypes && navigator.mimeTypes['application/x-mpvjs']),
        embedExists: Boolean(plugin),
        postMessageType: plugin ? typeof plugin.postMessage : 'missing',
        outerHTML: plugin ? plugin.outerHTML : ''
      };
    })()
  `);

  console.log(JSON.stringify(result, null, 2));
  writeLog(result);
  app.quit();
});
