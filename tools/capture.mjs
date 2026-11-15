import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifacts = join(root, "artifacts");
mkdirSync(artifacts, { recursive: true });

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
};

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://local").pathname);
  const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(root) || !existsSync(file)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
  response.end(readFileSync(file));
});

function browserCandidates() {
  const candidates = [process.env.CHROME_PATH, "/usr/bin/chromium", "/usr/bin/google-chrome"];
  const cacheRoots = [
    join(process.env.HOME || "", ".cache", "ms-playwright"),
    join(root, "..", "..", ".cache", "ms-playwright"),
    "/root/.cache/ms-playwright",
  ];
  for (const cache of cacheRoots) {
    if (!existsSync(cache)) continue;
    for (const entry of readdirSync(cache)) {
      if (!entry.startsWith("chromium-")) continue;
      candidates.push(join(cache, entry, "chrome-linux64", "chrome"));
      candidates.push(join(cache, entry, "chrome-linux", "chrome"));
    }
  }
  return candidates.filter(Boolean);
}

function findBrowser() {
  const browser = browserCandidates().find((candidate) => existsSync(candidate));
  if (!browser) {
    throw new Error("No Chromium found. Set CHROME_PATH to a Chrome/Chromium executable.");
  }
  return browser;
}

function runBrowser(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(findBrowser(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(new Error("Chrome screenshot timed out"));
    }, 30000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) rejectRun(new Error(stderr || `Chrome exited with ${code}`));
      else resolveRun();
    });
  });
}

async function screenshot(url, output, width, height) {
  await runBrowser([
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${width},${height}`,
      "--virtual-time-budget=1800",
      `--screenshot=${output}`,
      url,
    ]);
  if (!existsSync(output)) throw new Error(`Chrome did not write ${output}`);
  process.stdout.write(`wrote ${output}\n`);
}

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/tools/capture.html`;

try {
  await screenshot(
    `${base}?mode=compare&direction=rtl&progress=0.5&duration=2`,
    join(artifacts, "transitions-compare.png"),
    1920,
    390,
  );
  await screenshot(
    `${base}?mode=single&type=fog&direction=rtl&progress=0.5&duration=2`,
    join(artifacts, "mid-transition-fog-rtl.png"),
    640,
    360,
  );
} finally {
  server.close();
}
