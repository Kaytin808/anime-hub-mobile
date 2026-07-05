const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const bundleDir = path.join(rootDir, '.desktop-bundle');

function ensureCleanDir(target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
}

function copyInto(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`Missing required path: ${from}`);
  }

  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true });
}

function main() {
  ensureCleanDir(bundleDir);

  copyInto(path.join(rootDir, 'web', '.next', 'standalone'), path.join(bundleDir, 'web'));
  copyInto(path.join(rootDir, 'web', '.next', 'static'), path.join(bundleDir, 'web', '.next', 'static'));
  copyInto(path.join(rootDir, 'web', 'public'), path.join(bundleDir, 'web', 'public'));
  copyInto(
    path.join(rootDir, 'web', 'node_modules', 'next', 'dist', 'compiled'),
    path.join(bundleDir, 'web', 'node_modules', 'next', 'dist', 'compiled')
  );

  copyInto(path.join(rootDir, 'server', 'build'), path.join(bundleDir, 'server', 'build'));
  copyInto(path.join(rootDir, 'server', 'package.json'), path.join(bundleDir, 'server', 'package.json'));
  copyInto(path.join(rootDir, 'server', 'node_modules'), path.join(bundleDir, 'server', 'node_modules'));
  if (fs.existsSync(path.join(rootDir, 'server', '.env'))) {
    copyInto(path.join(rootDir, 'server', '.env'), path.join(bundleDir, 'server', '.env'));
  }

  copyInto(path.join(rootDir, 'desktop', 'bin'), path.join(bundleDir, 'desktop', 'bin'));
  copyInto(path.join(rootDir, 'desktop', 'mpv'), path.join(bundleDir, 'desktop', 'mpv'));
}

main();
