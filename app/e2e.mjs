import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const root = dirname(fileURLToPath(import.meta.url));
const artifacts = join(root, "..", "artifacts");

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  try {
    const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const buf = await readFile(join(root, path));
    res.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
const consoleErrors = [], pageErrors = [], audioRequests = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", e => pageErrors.push(e.message));
page.on("request", req => { if (/\.(wav|mp3|ogg|m4a|flac)$/i.test(req.url())) audioRequests.push(req.url()); });

/* Count live Web Audio nodes to prove synthesis is real and procedural. */
await page.addInitScript(() => {
  window.__audioNodes = 0;
  const count = () => { window.__audioNodes++; };
  const Proto = window.AudioScheduledSourceNode || window.AudioNode;
  if (Proto) {
    const orig = Proto.prototype.connect;
    Proto.prototype.connect = function (...a) { count(); return orig.apply(this, a); };
  }
});

await page.goto(base);
await page.waitForSelector(".grid .node");
const data = await page.evaluate(() => ({ ...window.__ECHO__ }));
console.log("seed:", data.seed);
console.log("correct order:", data.correctOrder.join(" -> "));

/* 1. Blank answering state: no material names/textures leaked on the grid. */
const blankLeak = await page.evaluate(() => {
  const names = ["木板", "碎石", "铁板", "石板", "沙地", "苔藓"];
  return names.some(n => document.querySelector(".grid").textContent.includes(n));
});
await page.screenshot({ path: join(artifacts, "01-answering-blank-grid.png"), fullPage: true });

/* 2. Exercise real-time playback: click play, let segments run, then stop. */
await page.click("#playBtn");
await page.waitForTimeout(1400);
const liveNodes = await page.evaluate(() => window.__audioNodes);
await page.click("#stopBtn");
await page.waitForTimeout(200);

/* 3. Correct arrangement via the exposed deterministic order, then submit. */
await page.evaluate(order => window.__ECHO__.setOrder(order), data.correctOrder);
await page.waitForSelector(".seq-slot.filled", { state: "attached" });
await page.screenshot({ path: join(artifacts, "02-arranged-before-submit.png"), fullPage: true });
await page.click("#submitBtn");
await page.waitForSelector(".grid-badge.ok");
const correctVerdict = await page.evaluate(() => window.__lastVerdict);
await page.screenshot({ path: join(artifacts, "03-correct-submission.png"), fullPage: true });

/* 4. Reset, then a deliberately wrong submission (swap first two materials). */
await page.evaluate(() => window.__ECHO__.reset());
const wrong = [...data.correctOrder];
[wrong[0], wrong[1]] = [wrong[1], wrong[0]];
await page.evaluate(order => window.__ECHO__.setOrder(order), wrong);
await page.click("#submitBtn");
await page.waitForSelector(".grid-badge.bad");
const wrongVerdict = await page.evaluate(() => window.__lastVerdict);
await page.screenshot({ path: join(artifacts, "04-wrong-submission.png"), fullPage: true });

/* 5. Recover: fix the order and confirm the path can still be closed. */
await page.evaluate(() => window.__ECHO__.reset());
await page.evaluate(order => window.__ECHO__.setOrder(order), data.correctOrder);
await page.click("#submitBtn");
await page.waitForSelector(".grid-badge.ok");

const report = {
  seed: data.seed,
  route: data.route,
  correctOrder: data.correctOrder,
  wrongOrder: wrong,
  blankGridNoMaterialLeak: !blankLeak,
  liveAudioNodeConnections: liveNodes,
  audioRequests,
  pageErrors,
  consoleErrors,
  correctVerdict: correctVerdict.verdict,
  wrongVerdict: wrongVerdict.verdict,
  wrongSlots: wrongVerdict.wrongs,
  result:
    correctVerdict.verdict === "ok" && wrongVerdict.verdict === "bad" && !blankLeak
      ? "correct submission passed; wrong submission rejected"
      : "FAILED"
};
writeFileSync(join(artifacts, "e2e-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
server.close();
if (report.result === "FAILED" || pageErrors.length || consoleErrors.length) process.exit(1);
