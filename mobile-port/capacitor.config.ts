import type { CapacitorConfig } from '@capacitor/cli';

const appUrl = process.env.CAPACITOR_SERVER_URL || 'http://192.168.0.250:3010';

const config: CapacitorConfig = {
  appId: 'com.animehub.mobile',
  appName: 'Anime Hub',
  webDir: 'out',
  server: {
    url: appUrl,
    cleartext: appUrl.startsWith('http://')
  },
  ios: {
    contentInset: 'automatic'
  }
};

export default config;
