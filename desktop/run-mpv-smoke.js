const { spawn } = require('child_process');
const electronPath = require('electron');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.ELECTRON_ENABLE_LOGGING = '1';

const child = spawn(electronPath, [path.join(__dirname, 'mpv-plugin-smoke.js')], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env
});

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

child.on('error', (error) => {
  console.error(error);
});

child.on('exit', (code) => {
  console.log(`mpv smoke electron exited with code ${code}`);
  process.exit(code || 0);
});
