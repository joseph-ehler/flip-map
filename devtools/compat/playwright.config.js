// Firefox 123.0 (Playwright 1.42.1's build) at the Flip 4's 240x320 screen, located in Gainesville.
// First time: npm install && npm run install-firefox
//   npm run check       the current build against the live map, search and routing services
//   npm run audit       key, screen and lifecycle tests, on recorded answers (fixtures/), with faults
//   npm run long-drive  a recorded 60-120 minute drive with GPS noise, dropouts and network trouble
// FLIPMAP_APP=<folder> runs any of them against another copy of the app.
'use strict';
const { defineConfig } = require('@playwright/test');

const HOURS = 3600 * 1000;

module.exports = defineConfig({
  testDir: '.',
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
  },
  projects: [
    { name: 'compat', testMatch: 'check.spec.js' },
    // Recorded answers need every request to reach Playwright, and Firefox's service worker hides the
    // map tiles it fetches, so these run without it (as on a first visit).
    { name: 'audit', testMatch: /(keys|lifecycle)\.spec\.js/, use: { serviceWorkers: 'block' } },
    { name: 'long-drive', testMatch: 'long-drive.spec.js', timeout: 3 * HOURS, use: { serviceWorkers: 'block' } },
    { name: 'long-drive-chromium', testMatch: 'long-drive.spec.js', timeout: 3 * HOURS, use: { browserName: 'chromium', serviceWorkers: 'block' } }
  ]
});
