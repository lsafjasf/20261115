import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

process.on("unhandledRejection", (err) => {
  console.log("UNHANDLED", err?.stack || err);
  process.exit(2);
});

const ROOT = join(import.meta.dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
const page = await context.newPage();
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("CONSOLE-ERROR", msg.text());
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.avSync !== undefined);

const stateInfo = () => page.evaluate(() => {
  const s = window.avSync.state;
  return {
    playing: s.playing,
    position: window.avSync.getPosition(),
    deltaMs: s.deltaMs,
    calibrationMs: s.calibrationMs,
    userDelayMs: s.userDelayMs,
    effectiveMs: window.avSync.effectiveDelayMs(),
    flash: s.lastFlashTransportS,
    beat: s.lastBeatTransportS,
    scheduled: s.scheduledBeats.map((b) => ({ index: b.index, t: b.transportS })),
  };
});

// 1) 初始结构：8 个闪光，时间点在 20 秒内
const flashTimes = await page.evaluate(() => window.avSync.flashTimes);
check("动画含 8 个闪光", flashTimes.length === 8,
  flashTimes.map((t) => t.toFixed(2)).join(", "));
check("闪光全部落在 20 秒内", flashTimes[0] > 0 && flashTimes[7] < 20);

// 2) 单时钟：播放与暂停由同一个 getPosition 驱动
await page.evaluate(() => window.avSync.play());
await sleep(300);
let info = await stateInfo();
check("播放后同一时钟推进", info.playing && info.position > 0.2 && info.position < 0.5,
  `position=${info.position.toFixed(3)}`);

await page.evaluate(() => window.avSync.pause());
const pausedAt = await page.evaluate(() => window.avSync.getPosition());
await sleep(200);
const stillAt = await page.evaluate(() => window.avSync.getPosition());
check("暂停时时钟冻结（单时钟）", Math.abs(pausedAt - stillAt) < 1e-9,
  `${pausedAt.toFixed(3)} vs ${stillAt.toFixed(3)}`);

// 3) 逐帧走同一时钟，步长 1/60 秒
const beforeStep = await page.evaluate(() => window.avSync.getPosition());
await page.evaluate(() => window.avSync.stepFrame(1));
const afterStep = await page.evaluate(() => window.avSync.getPosition());
check("逐帧推进 1/60 秒（同一时钟）", Math.abs((afterStep - beforeStep) - 1 / 60) < 1e-9,
  `+${(afterStep - beforeStep).toFixed(4)}s`);

// 4) 拖动定位使用同一时钟，随后播放继续沿用
await page.evaluate(() => window.avSync.seekTo(10));
let pos = await page.evaluate(() => window.avSync.getPosition());
check("拖动到 10 秒", Math.abs(pos - 10) < 1e-9, `position=${pos.toFixed(3)}`);
await page.evaluate(() => window.avSync.play());
await sleep(200);
pos = await page.evaluate(() => window.avSync.getPosition());
check("拖动后播放继续走同一时钟", pos > 10.1 && pos < 10.4,
  `position=${pos.toFixed(3)}`);
await page.evaluate(() => window.avSync.pause());
await page.evaluate(() => window.avSync.seekTo(0));

// 5) 制造明显延迟：附加 250ms 音频延迟（上限 300ms）
await page.evaluate(() => {
  const slider = document.getElementById("delaySlider");
  slider.value = "250";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
});
info = await stateInfo();
check("音频延迟可设且不超过 300ms",
  info.userDelayMs === 250 && info.effectiveMs === 250,
  `user=${info.userDelayMs}, effective=${info.effectiveMs}`);

await page.evaluate(() => window.avSync.play());
await page.waitForFunction(
  () => window.avSync.state.lastBeatTransportS !== null,
  { timeout: 5000 },
);
await sleep(100);
info = await stateInfo();
check("界面显示最近闪光→节拍时间差 +250ms",
  info.deltaMs !== null && Math.abs(info.deltaMs - 250) < 1,
  `delta=${info.deltaMs?.toFixed(1)}ms`);
check("节拍调度时间 = 闪光时间 + 延迟（同一时钟推导）",
  Math.abs(info.scheduled[0].t - (info.flash + 0.25)) < 0.002,
  `flash=${info.flash}s beat=${info.beat}s`);
await page.evaluate(() => window.avSync.pause());

// 6) 实际校正一次：保存后生效延迟归零，下一轮时间差为 0
await page.evaluate(() => window.avSync.saveCalibration());
info = await stateInfo();
check("保存校正偏移 = 250ms", info.calibrationMs === 250,
  `calib=${info.calibrationMs}ms`);
check("校正后生效音频延迟归零", info.effectiveMs === 0,
  `effective=${info.effectiveMs}ms`);
const storedCalib = await page.evaluate(
  () => localStorage.getItem("avsync.calibrationMs"),
);
check("校正已持久化到 localStorage", storedCalib === "250", `stored=${storedCalib}`);

await page.evaluate(() => window.avSync.seekTo(0));
await page.evaluate(() => window.avSync.play());
await page.waitForFunction(
  () => window.avSync.state.lastBeatTransportS !== null
    && window.avSync.state.shownBeatIdx === 0,
  { timeout: 5000 },
);
await sleep(100);
info = await stateInfo();
check("校正后新一次闪光与节拍时间差≈0",
  info.deltaMs !== null && Math.abs(info.deltaMs) < 1,
  `delta=${info.deltaMs?.toFixed(1)}ms`);
await page.evaluate(() => window.avSync.pause());

// 7) 刷新页面：校正偏移与用户延迟都必须恢复
await page.reload();
await page.waitForFunction(() => window.avSync !== undefined);
info = await stateInfo();
check("刷新后校正偏移恢复为 250ms", info.calibrationMs === 250,
  `calib=${info.calibrationMs}ms`);
check("刷新后用户延迟 250ms 也恢复", info.userDelayMs === 250,
  `user=${info.userDelayMs}ms`);
check("刷新后生效延迟仍为 0（校正持续有效）", info.effectiveMs === 0,
  `effective=${info.effectiveMs}ms`);
const calibText = await page.textContent("#calibValue");
check("界面校正读数显示恢复值", calibText.trim() === "250 ms", calibText.trim());

// 8) 刷新后再次播放，端到端确认时间差归零
await page.evaluate(() => window.avSync.play());
await page.waitForFunction(
  () => window.avSync.state.lastBeatTransportS !== null,
  { timeout: 5000 },
);
await sleep(100);
info = await stateInfo();
check("刷新后播放的闪光-节拍时间差≈0",
  info.deltaMs !== null && Math.abs(info.deltaMs) < 1,
  `delta=${info.deltaMs?.toFixed(1)}ms`);
await page.evaluate(() => window.avSync.pause());

// 9) 清除校正后回到原始 250ms 延迟
await page.evaluate(() => window.avSync.clearCalibration());
info = await stateInfo();
check("清除校正后生效延迟恢复为 250ms", info.effectiveMs === 250,
  `effective=${info.effectiveMs}ms`);

await context.close();
await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
process.exit(failed.length ? 1 : 0);
