import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  timeout: 20_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4273",
    viewport: { width: 1280, height: 720 },
    headless: true,
    colorScheme: "dark"
  },
  webServer: {
    command: "node server.mjs",
    url: "http://127.0.0.1:4273",
    reuseExistingServer: true,
    timeout: 10_000
  }
});
