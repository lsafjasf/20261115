import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4391",
    headless: true,
    viewport: { width: 1440, height: 1080 },
    acceptDownloads: true,
    launchOptions: {
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
      ],
    },
  },
  webServer: {
    command: "PORT=4391 npm run serve",
    url: "http://127.0.0.1:4391",
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
