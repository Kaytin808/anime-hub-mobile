const { spawn } = require('child_process');
const electronPath = require('electron');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.ELECTRON_START_URL = env.ELECTRON_START_URL || 'http://localhost:3000';

const child = spawn(electronPath, [path.join(__dirname, 'main.js')], {
  stdio: 'inherit',
  env
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
