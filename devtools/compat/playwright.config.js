// Firefox 123.0 (Playwright 1.42.1's build) at the Flip 4's 240x320 screen, located in Gainesville.
// Run: npm run check   (first time: npm install && npm run install-firefox)
'use strict';
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  timeout: 120000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'results/artifacts',
  webServer: { command: 'node serve.js', port: 8418, reuseExistingServer: false },
  use: {
    browserName: 'firefox',
    baseURL: 'http://localhost:8418',
    viewport: { width: 240, height: 320 },
    deviceScaleFactor: 1,
    geolocation: { latitude: 29.6516, longitude: -82.3248, accuracy: 8 },
    permissions: ['geolocation'],
    locale: 'en-US',
    timezoneId: 'America/New_York'
  }
});
