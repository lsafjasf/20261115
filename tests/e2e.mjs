import { chromium } from "playwright";
import { ROUTES } from "../app/js/data.js";

const assert = (cond, msg) => {
  if (!cond) throw new Error("断言失败: " + msg);
  console.log("  ✓ " + msg);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.context().addInitScript((dir) => {
  window.__downloads = [];
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith("data:")) {
      window.__downloads.push({ name: this.download, len: this.href.length });
      return;
    }
    return origClick.call(this);
  };
});

await page.goto(`${process.env.TEST_BASE}/app/index.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(400);

console.log("\n[1] 内置数据与初始渲染");
const initial = await page.evaluate(() => ({
  routes: document.querySelectorAll("#routeSelect option").length,
  anomalies: [...document.querySelectorAll(".anomaly-item")].map((el) => el.className),
  stations: document.querySelectorAll(".station-item").length,
}));
assert(initial.routes === 3, `内置 3 条路线（实际 ${initial.routes}）`);
assert(initial.stations === 8, "R1 渲染 8 个站点");
assert(initial.anomalies.length === 4, "R1 列出 4 条异常（2 超速 + 1 逆行 + 1 未停靠）");

console.log("\n[2] 时间段过滤 —— 地图/曲线/站点/异常同步");
const r1 = ROUTES[0];
const firstSpeed = r1.anomalies.find((a) => a.type === "speed");
const skipEv = r1.anomalies.find((a) => a.type === "skip");
const reverseEv = r1.anomalies.find((a) => a.type === "reverse");
const windowStart = firstSpeed.start - 10;
const windowEnd = firstSpeed.start + 8;
await page.evaluate(([s, e]) => {
  const n = window.__audit.routes[0].samples.length - 1;
  const rs = document.getElementById("rangeStart");
  rs.value = Math.round((s / n) * 100);
  rs.dispatchEvent(new Event("input", { bubbles: true }));
  const re = document.getElementById("rangeEnd");
  re.value = Math.round((e / n) * 100);
  re.dispatchEvent(new Event("input", { bubbles: true }));
}, [windowStart, windowEnd]);

const filtered = await page.evaluate(() => ({
  visibleAnoms: [...document.querySelectorAll(".anomaly-item:not(.outside)")].length,
  totalAnoms: document.querySelectorAll(".anomaly-item").length,
  outsideStations: document.querySelectorAll(".station-item.outside").length,
  startText: document.getElementById("rangeStartText").textContent,
  endText: document.getElementById("rangeEndText").textContent,
  cntSpeed: document.getElementById("cntSpeed").textContent,
  cntReverse: document.getElementById("cntReverse").textContent,
  cntSkip: document.getElementById("cntSkip").textContent,
}));
assert(filtered.visibleAnoms === 1, `窗口内仅 1 条异常可见（实际 ${filtered.visibleAnoms}）`);
assert(filtered.cntSpeed === "1" && filtered.cntReverse === "0" && filtered.cntSkip === "0",
  `计数同步：超速1/逆行0/未停靠0（实际 ${filtered.cntSpeed}/${filtered.cntReverse}/${filtered.cntSkip}）`);
assert(filtered.outsideStations > 0, "窗口外站点变灰");

console.log("\n[3] 三类异常筛选开关");
await page.click("#rangeReset");
await page.uncheck("#fSpeed");
let afterFilter = await page.evaluate(() =>
  [...document.querySelectorAll(".anomaly-item")].map((el) => el.className));
assert(afterFilter.every((c) => !c.includes("type-speed")), "关闭超速后列表无超速项");
assert(afterFilter.some((c) => c.includes("type-reverse")) && afterFilter.some((c) => c.includes("type-skip")),
  "逆行与未停靠仍保留");

await page.uncheck("#fReverse");
afterFilter = await page.evaluate(() =>
  [...document.querySelectorAll(".anomaly-item")].map((el) => el.className));
assert(afterFilter.every((c) => c.includes("type-skip")), "再关逆行后只剩未停靠项");

await page.check("#fSpeed");
await page.check("#fReverse");
const restored = await page.evaluate(() => document.querySelectorAll(".anomaly-item").length);
assert(restored === 4, `重新勾选后恢复 4 条（实际 ${restored}）`);

console.log("\n[4] 时刻跳转 —— 异常列表");
const cursorBefore = await page.evaluate(() => document.getElementById("cursorTime").textContent);
await page.evaluate(() => {
  document.querySelector(".anomaly-item.type-reverse").click();
});
await page.waitForTimeout(150);
const afterReverseJump = await page.evaluate(() => document.getElementById("cursorTime").textContent);
assert(afterReverseJump !== cursorBefore, "点击逆行异常后游标时刻改变");
assert(afterReverseJump.startsWith("08:11"), `跳转到逆行时刻 08:11 附近（实际 ${afterReverseJump}）`);

await page.evaluate(() => {
  document.querySelector(".anomaly-item.type-skip").click();
});
await page.waitForTimeout(150);
const afterSkipJump = await page.evaluate(() => document.getElementById("cursorTime").textContent);
assert(afterSkipJump.startsWith("08:09"), `未停靠跳转到 08:09（实际 ${afterSkipJump}）`);

console.log("\n[5] 时刻跳转 —— 速度曲线点击");
const chartBox = await page.locator("#speedCanvas").boundingBox();
await page.mouse.click(chartBox.x + chartBox.width * 0.7, chartBox.y + chartBox.height * 0.4);
const afterChartClick = await page.evaluate(() => document.getElementById("cursorTime").textContent);
assert(/08:1[4-9]|08:2/.test(afterChartClick), `曲线点击跳转到后段时刻（实际 ${afterChartClick}）`);

console.log("\n[6] 时刻跳转 —— 站点列表");
await page.evaluate(() => document.querySelectorAll(".station-item")[3].click());
const afterStationJump = await page.evaluate(() => document.getElementById("cursorTime").textContent);
assert(afterStationJump.includes("km/h"), "站点点击后游标更新");

console.log("\n[6b] 时刻跳转 —— 地图画布命中检测");
await page.click("#rangeReset");
const mapHit = await page.evaluate(() => {
  const canvas = document.getElementById("mapCanvas");
  const rect = canvas.getBoundingClientRect();
  const target = window.__audit.routes[0].anomalies.find((a) => a.type === "reverse");
  const p = window.__audit.routes[0].samples[target.start];
  const hit = canvas._hitTest(rect.width * 0.5, rect.height * 0.5);
  const hitAtMarker = (() => {
    for (let x = 0; x < rect.width; x += 8) {
      for (let y = 0; y < rect.height; y += 8) {
        const h = canvas._hitTest(x, y);
        if (h && h.anomaly && h.anomaly.type === "reverse") return h.t;
      }
    }
    return null;
  })();
  return { markerT: hitAtMarker, targetStart: target.start, markerSample: p.t };
});
assert(mapHit.markerT === mapHit.targetStart,
  `地图逆行标记可命中并返回起始时刻（期望 ${mapHit.targetStart}，实际 ${mapHit.markerT}）`);

console.log("\n[7] 窗口外跳转自动扩展时间窗");
await page.evaluate(([s, e]) => {
  const n2 = window.__audit.routes[0].samples.length - 1;
  const rs = document.getElementById("rangeStart");
  rs.value = Math.round((s / n2) * 100);
  rs.dispatchEvent(new Event("input", { bubbles: true }));
  const re = document.getElementById("rangeEnd");
  re.value = Math.round((e / n2) * 100);
  re.dispatchEvent(new Event("input", { bubbles: true }));
}, [0, 30]);
await page.evaluate(() => document.querySelector(".anomaly-item.type-reverse").click());
await page.waitForTimeout(150);
const expanded = await page.evaluate(() => ({
  start: document.getElementById("rangeStartText").textContent,
  cursor: document.getElementById("cursorTime").textContent,
}));
assert(expanded.cursor.startsWith("08:11"), `游标仍跳到逆行时刻（实际 ${expanded.cursor}）`);
assert(!expanded.start.startsWith("08:00"), `时间窗已自动扩展（窗口起点 ${expanded.start}）`);

console.log("\n[8] 播放功能");
await page.click("#rangeReset");
const c0 = await page.evaluate(() => document.getElementById("cursorTime").textContent);
await page.click("#playBtn");
await page.waitForTimeout(700);
await page.click("#playBtn");
const c1 = await page.evaluate(() => document.getElementById("cursorTime").textContent);
assert(c1 !== c0, `播放中游标推进（${c0} → ${c1}）`);

console.log("\n[9] PNG 审计报告导出");
await page.click("#exportBtn");
await page.waitForTimeout(400);
const downloads = await page.evaluate(() => window.__downloads);
assert(downloads.length === 1, `触发 1 次下载（实际 ${downloads.length}）`);
assert(downloads[0].name.endsWith(".png"), `文件名 .png 结尾（${downloads[0].name}）`);
assert(downloads[0].len > 200000, `PNG dataURL 体积合理（${(downloads[0].len / 1024).toFixed(0)} KB）`);

console.log("\n[10] 其他路线切换与无外部地图请求");
const urls = [];
page.on("request", (req) => {
  const u = new URL(req.url());
  if (!["127.0.0.1", "localhost"].includes(u.hostname)) urls.push(req.url());
});
await page.selectOption("#routeSelect", "R3");
await page.waitForTimeout(300);
const r3View = await page.evaluate(() => ({
  anomalies: document.querySelectorAll(".anomaly-item").length,
  skip: document.getElementById("cntSkip").textContent,
  speed: document.getElementById("cntSpeed").textContent,
}));
assert(r3View.anomalies === 3 && r3View.skip === "2" && r3View.speed === "1",
  `R3 切换后数据正确（异常 ${r3View.anomalies}，未停靠 ${r3View.skip}，超速 ${r3View.speed}）`);
assert(urls.length === 0, `无外部域名请求（实际 ${urls.length}）`);

await page.screenshot({ path: "artifacts/e2e-r3.png", fullPage: true });
await page.selectOption("#routeSelect", "R1");
await page.click("#rangeReset");
await page.evaluate(() => document.querySelector(".anomaly-item.type-reverse").click());
await page.waitForTimeout(200);
await page.screenshot({ path: "artifacts/e2e-jump-reverse.png", fullPage: true });

assert(errors.length === 0, `无控制台错误（${errors.length} 条）`);
console.log("\n全部 E2E 断言通过 ✅");
await browser.close();
