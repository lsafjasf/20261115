import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4188",
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
    launchOptions: {
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    }
  },
  webServer: {
    command: "npx vite --host 127.0.0.1 --port 4188",
    url: "http://127.0.0.1:4188",
    reuseExistingServer: true,
    timeout: 30_000
  }
});
