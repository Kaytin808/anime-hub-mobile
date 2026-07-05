import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.animehub.mobile',
  appName: 'Anime Hub',
  webDir: 'out',
  server: {
    url: 'http://192.168.0.250:3010',
    cleartext: true
  },
  ios: {
    contentInset: 'automatic'
  }
};

export default config;
