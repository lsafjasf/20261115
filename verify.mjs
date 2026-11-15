import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const URL = "file:///home/hj/userfeedback/uid270/index.html";
const ART = "/home/hj/userfeedback/uid270/artifacts";

function parseWavDuration(bytes) {
  const dv = new DataView(Uint8Array.from(bytes).buffer);
  const sampleRate = dv.getUint32(24, true);
  const dataSize = dv.getUint32(40, true);
  const blockAlign = dv.getUint16(32, true);
  return { sampleRate, dataSize, duration: dataSize / blockAlign / sampleRate };
}

function rmsOfWav(bytes) {
  const dv = new DataView(Uint8Array.from(bytes).buffer);
  const n = dv.getUint32(40, true) / 2;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = dv.getInt16(44 + i * 2, true) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
page.on("pageerror", e => { console.error("PAGE ERROR:", e.message); process.exit(1); });
await page.goto(URL);
await page.waitForFunction(() => window.__ready === true);

// ---- 场景 1：实际修复（两组均启用，参数针对 50/100 Hz 轰鸣调优） ----
await page.evaluate(() => window.__repair.setParams({
  A: { hp: 120, notchF: 50, notchQ: 8, gate: -45, bypass: false },
  B: { hp: 80, notchF: 100, notchQ: 6, gate: -50, bypass: false },
}));
const r1 = await page.evaluate(() => window.__repair.export());
const d1 = parseWavDuration(r1.wav);
const rms1 = rmsOfWav(r1.wav);
console.log("场景1 修复导出:", JSON.stringify(r1.report, null, 2));
console.log(`场景1 WAV头: ${d1.sampleRate}Hz, data=${d1.dataSize}B, 时长=${d1.duration.toFixed(4)}s, RMS=${rms1.toFixed(4)}`);

if (d1.duration !== 10) throw new Error(`导出时长异常: ${d1.duration}`);
if (r1.report.samples !== 441000) throw new Error("采样数异常");
if (r1.report.bypass.A !== false || r1.report.bypass.B !== false) throw new Error("旁路状态与设置不一致");
if (parseFloat(r1.report.lowBandReductionDb) >= -6) throw new Error("低频轰鸣抑制不足");
if (rms1 < 0.01) throw new Error("主旋律疑似被门限切断（RMS 过低）");

writeFileSync(`${ART}/repaired.wav`, Buffer.from(r1.wav));

// ---- 场景 2：旁路对比（旁路 B 组，确认导出报告如实反映） ----
await page.evaluate(() => window.__repair.setParams({ B: { bypass: true } }));
const r2 = await page.evaluate(() => window.__repair.export());
const d2 = parseWavDuration(r2.wav);
console.log(`场景2 旁路B导出: 时长=${d2.duration.toFixed(4)}s, bypass=${JSON.stringify(r2.report.bypass)}`);
if (d2.duration !== 10) throw new Error("旁路导出时长异常");
if (r2.report.bypass.B !== true || r2.report.bypass.A !== false) throw new Error("旁路状态不一致");

// ---- 场景 3：全部旁路 = 原音直通，低频能量应回到污染水平 ----
await page.evaluate(() => window.__repair.setParams({ A: { bypass: true }, B: { bypass: true } }));
const r3 = await page.evaluate(() => window.__repair.export());
console.log(`场景3 全旁路: 低频能量=${r3.report.lowBandAfter} (修复前 ${r3.report.lowBandBefore})`);
if (Math.abs(r3.report.lowBandAfter - r3.report.lowBandBefore) > 1e-6) {
  throw new Error("全旁路时应与原音一致");
}

// 恢复场景1参数并截图
await page.evaluate(() => window.__repair.setParams({
  A: { hp: 120, notchF: 50, notchQ: 8, gate: -45, bypass: false },
  B: { hp: 80, notchF: 100, notchQ: 6, gate: -50, bypass: false },
}));
await page.evaluate(() => window.__repair.export());
await page.screenshot({ path: `${ART}/ui.png`, fullPage: true });

await browser.close();
console.log("ALL CHECKS PASSED");
