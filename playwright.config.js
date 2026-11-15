const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  testMatch: /.*\.spec\.js/,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:8123',
    headless: true,
  },
  webServer: {
    command: 'node tools/static-server.js',
    url: 'http://127.0.0.1:8123/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
});
