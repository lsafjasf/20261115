import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4317",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 4317 --strictPort",
    url: "http://127.0.0.1:4317",
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
