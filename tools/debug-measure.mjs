import { chromium } from "/tmp/node_modules/playwright/index.mjs";
import { createServer } from "http";
import { readFileSync } from "fs";
import { extname, join } from "path";

const root = join(import.meta.dirname, "..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream" });
    res.end(readFileSync(join(root, path)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(7824, r));

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
page.on("console", (m) => console.log("[console]", m.type(), m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
await page.goto("http://localhost:7824/", { waitUntil: "networkidle" });

const probe = await page.evaluate(async () => {
  const out = {};
  try {
    const oac = new OfflineAudioContext(1, 44100, 44100);
    const buf = oac.createBuffer(1, 1, 44100);
    buf.getChannelData(0)[0] = 1;
    const src = oac.createBufferSource();
    src.buffer = buf;
    src.connect(oac.destination);
    src.start(0);
    const rendered = await oac.startRendering();
    out.offlineOk = rendered.length;
  } catch (e) { out.offlineErr = String(e); }
  return out;
});
console.log("probe:", JSON.stringify(probe));

await page.click("#kickBtn");
await page.waitForTimeout(500);
await page.click("#measureBtn");
await page.waitForTimeout(3000);
console.log("measureResult:", await page.locator("#measureResult").innerText());
await browser.close();
server.close();
