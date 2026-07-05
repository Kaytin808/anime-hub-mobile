const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const logPath = path.join(process.cwd(), 'desktop', 'electron-min-smoke.log');
fs.writeFileSync(logPath, 'starting electron min smoke\n');

app.whenReady().then(async () => {
  fs.appendFileSync(logPath, 'ready\n');
  const win = new BrowserWindow({ width: 320, height: 240, show: false });
  await win.loadURL('data:text/html,<h1>ok</h1>');
  fs.appendFileSync(logPath, 'loaded\n');
  app.quit();
});
