import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'space.bongdo.nit.shell',
  appName: 'nit',
  webDir: 'www',
  server: {
    url: 'https://bongdo.space/nit/',
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#16171b',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#16171b',
      showSpinner: false,
    },
  },
};

export default config;
