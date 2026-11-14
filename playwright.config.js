import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 75_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:45173",
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce"
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:45173",
    reuseExistingServer: true,
    timeout: 15_000
  }
});
