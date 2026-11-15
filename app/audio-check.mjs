import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const buf = await readFile(join(root, path));
  res.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream" });
  res.end(buf);
});
await new Promise(r => server.listen(0, r));

const browser = await chromium.launch();
const page = await browser.newPage();
const sampleRequests = [];
page.on("request", req => {
  if (/\.(wav|mp3|ogg|m4a|flac|aac|webm)$/i.test(req.url())) sampleRequests.push(req.url());
});
await page.goto(`http://127.0.0.1:${server.address().port}/`);

const probe = await page.evaluate(async () => {
  const eng = new AudioEngine();
  eng.ensure();
  const ctx = eng.ctx;
  const before = ctx.sampleRate;
  const mat = MATERIALS[0];
  eng.step(mat, ctx.currentTime + 0.01, 1);
  eng.preview(MATERIALS[2]);
  await new Promise(r => setTimeout(r, 100));
  return {
    sampleRate: before,
    hasConvolver: !!eng.convolver && eng.convolver.buffer.length > 0,
    impulseChannels: eng.convolver.buffer.numberOfChannels,
    wetLevel: eng.wetGain.gain.value,
    materialCount: MATERIALS.length,
    distinctReverb: new Set(MATERIALS.map(m => m.rvb)).size,
    distinctDamping: new Set(MATERIALS.map(m => m.dmp)).size,
    distinctPans: new Set(MATERIALS.map(m => m.pan)).size,
    state: ctx.state
  };
});

console.log(JSON.stringify({ sampleRequests, probe }, null, 2));
await browser.close();
server.close();
if (sampleRequests.length || !probe.hasConvolver || probe.distinctReverb < 6) process.exit(1);
