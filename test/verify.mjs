import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer(async (req, res) => {
  const path = join(ROOT, req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0]);
  try {
    const data = await readFile(path);
    res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const SEED = 42;

function snapshot() {
  return window.__game.clips.map((c) => ({
    templateId: c.templateId,
    variant: c.variant,
    params: c.params,
    specHash: c.spectrum.slice(0, 64).reduce((a, v) => a + v, 0).toFixed(6),
  }));
}

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => { console.error("PAGE ERROR:", e.message); process.exit(1); });

await page.goto(`${BASE}/?seed=${SEED}`);
await page.evaluate(() => window.__ready);

// ---- 同 seed 重开一致性：先记录初始快照 ----
const snap1 = await page.evaluate(snapshot);

// 通过测试钩子读取映射（界面本身不显示参数）
const tplOf = await page.evaluate(() => window.__game.clips.map((c) => c.templateId));
console.log("卡片->模板映射:", tplOf.join(","));

const correctPair = [];
for (let t = 0; t < 3; t++) {
  const idxs = tplOf.map((v, i) => (v === t ? i : -1)).filter((i) => i >= 0);
  correctPair.push(idxs);
}
const [okA, okB] = correctPair[0];
// 找一个与 okA 不同模板的错误配对
const wrongB = tplOf.findIndex((v) => v !== tplOf[okA]);

// ---- 1) 完成一次正确匹配 ----
await page.click(`.card[data-index="${okA}"]`);
await page.click(`.card[data-index="${okB}"]`);
let state = await page.evaluate(() => ({
  matched: window.__game.matched,
  errors: window.__game.errors,
  pairs: window.__game.pairs.map((p) => ({ ok: p.ok, sim: p.similarity })),
}));
console.log(`正确匹配: 卡片${okA}+${okB} ->`, JSON.stringify(state));
if (state.matched !== 1 || state.errors !== 0 || !state.pairs[0].ok) {
  throw new Error("正确匹配断言失败");
}
const okLocked = await page.evaluate(
  ([a, b]) =>
    document.querySelector(`.card[data-index="${a}"]`).classList.contains("locked") &&
    document.querySelector(`.card[data-index="${b}"]`).classList.contains("locked"),
  [okA, okB]
);
if (!okLocked) throw new Error("正确配对未锁定");

// ---- 2) 完成一次错误匹配 ----
await page.click(`.card[data-index="${correctPair[1][0]}"]`);
await page.click(`.card[data-index="${wrongB}"]`);
state = await page.evaluate(() => ({
  matched: window.__game.matched,
  errors: window.__game.errors,
  over: window.__game.over,
  pairs: window.__game.pairs.map((p) => ({ ok: p.ok, sim: p.similarity })),
}));
console.log(`错误匹配: 卡片${correctPair[1][0]}+${wrongB} ->`, JSON.stringify(state));
if (state.errors !== 1 || state.pairs[1].ok) throw new Error("错误匹配断言失败");

// ---- 3) 第二次错误 -> 失败结算 ----
const remaining = await page.evaluate(() =>
  window.__game.clips
    .map((c, i) => ({ i, locked: c.el.classList.contains("locked"), t: c.templateId }))
    .filter((c) => !c.locked)
);
// 剩余未锁定卡片中挑一对不同模板的
const p2a = remaining[0].i;
const p2b = remaining.find((c) => c.t !== remaining[0].t)?.i ?? remaining[1].i;
await page.click(`.card[data-index="${p2a}"]`);
await page.click(`.card[data-index="${p2b}"]`);
state = await page.evaluate(() => ({
  errors: window.__game.errors,
  over: window.__game.over,
  resultVisible: !document.getElementById("result").classList.contains("hidden"),
  title: document.getElementById("result-title").textContent,
  rows: document.querySelectorAll("#result-table tbody tr").length,
}));
console.log("失败后结算:", JSON.stringify(state));
if (!state.over || state.errors !== 2 || !state.resultVisible || state.rows !== 6) {
  throw new Error("失败结算断言失败");
}
await page.screenshot({ path: "artifacts/fail-result.png", fullPage: true });

// ---- 4) 同 seed 重开一致性 ----
await page.click("#restart");
await page.evaluate(() => window.__ready);
const snap2 = await page.evaluate(snapshot);
if (JSON.stringify(snap1) !== JSON.stringify(snap2)) {
  throw new Error("同 seed 重开结果不一致！");
}
console.log("同 seed 重开（按钮）: 卡片顺序/参数/频谱完全一致 ✓");

await page.reload();
await page.evaluate(() => window.__ready);
const snap3 = await page.evaluate(snapshot);
if (JSON.stringify(snap1) !== JSON.stringify(snap3)) {
  throw new Error("同 seed 刷新页面结果不一致！");
}
console.log("同 seed 刷新页面: 完全一致 ✓");

// 换 seed 应不同
await page.goto(`${BASE}/?seed=43`);
await page.evaluate(() => window.__ready);
const snap4 = await page.evaluate(snapshot);
if (JSON.stringify(snap1) === JSON.stringify(snap4)) {
  throw new Error("不同 seed 结果竟然相同！");
}
console.log("不同 seed (43): 结果不同 ✓");

await browser.close();
server.close();
console.log("\n全部验证通过 ✅");
