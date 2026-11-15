import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = join(import.meta.dirname, "..");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};
const server = createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  res.writeHead(200, {
    "content-type": mime[extname(path)] ?? "application/octet-stream",
  });
  res.end(await readFile(join(root, path)));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.avSync !== undefined);

await page.evaluate(() => avSync.play());
await page.waitForFunction(() => avSync.getPosition() >= 20, { timeout: 24000 });
await new Promise((r) => setTimeout(r, 300));

const summary = await page.evaluate(() => ({
  position: avSync.getPosition(),
  playing: avSync.state.playing,
  flashCount: avSync.state.shownFlashIdx + 1,
  beatCount: avSync.state.shownBeatIdx + 1,
  finalDeltaMs: avSync.state.deltaMs,
}));

const checks = [
  ["播放结束停在 20.000s", Math.abs(summary.position - 20) < 0.01],
  ["结束后自动暂停", summary.playing === false],
  ["8 个闪光全部触发", summary.flashCount === 8],
  ["8 个节拍全部触发", summary.beatCount === 8],
  ["无校正时差为 0", summary.finalDeltaMs === 0],
];
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
console.log(JSON.stringify(summary));

await browser.close();
server.close();
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
