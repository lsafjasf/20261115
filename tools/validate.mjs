import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://local").pathname);
  const file = resolve(root, `.${pathname}`);
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

const browser = browserCandidates().find((candidate) => existsSync(candidate));
if (!browser) throw new Error("No Chromium found. Set CHROME_PATH.");

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/tools/validate.html`;

try {
  const result = await new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      browser,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--virtual-time-budget=8000",
        "--dump-dom",
        url,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectRun(new Error("Chrome validation timed out"));
    }, 30000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (status) => {
      clearTimeout(timeout);
      resolveRun({ status, stdout, stderr });
    });
  });
  const match = result.stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/);
  if (!match) {
    const diagnostic = [
      `status=${result.status}`,
      `stdout=${result.stdout.slice(0, 1200)}`,
      `stderr=${result.stderr.slice(-800)}`,
    ].join("\n");
    throw new Error(`Validation page returned no result\n${diagnostic}`);
  }
  const report = JSON.parse(match[1]);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
} finally {
  server.close();
}
