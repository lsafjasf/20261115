import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "browser.spec.js",
  timeout: 30000,
  fullyParallel: false,
  reporter: [["line"]],
  use: {
    baseURL: "http://127.0.0.1:5189",
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    screenshot: "off",
  },
  webServer: {
    command: "npm run dev -- --port 5189",
    url: "http://127.0.0.1:5189",
    reuseExistingServer: false,
    timeout: 20000,
  },
});
