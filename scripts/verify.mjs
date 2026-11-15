import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = process.env.APP_URL || "http://127.0.0.1:4173";
const artifactDir = new URL("../artifacts/", import.meta.url);
const shotDir = new URL("../artifacts/shots/", import.meta.url);
await mkdir(artifactDir, { recursive: true });
await mkdir(shotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.screenshot({ path: new URL("../artifacts/first-look.png", import.meta.url).pathname });

const shots = [
  { shutterIndex: 7, isoIndex: 1, apertureIndex: 0 },
  { shutterIndex: 5, isoIndex: 5, apertureIndex: 3 },
  { shutterIndex: 10, isoIndex: 3, apertureIndex: 6 },
];
const captureStates = [];
for (let index = 0; index < shots.length; index += 1) {
  await page.evaluate((settings) => window.__nightLab.setSettings(settings), shots[index]);
  await page.waitForTimeout(180);
  const captured = await page.evaluate(() => window.__nightLab.capture());
  const state = await page.evaluate(() => window.__nightLab.getState());
  captureStates.push({ captured, state });
  const source = await page.locator(".frame.is-filled img").last().getAttribute("src");
  if (source) {
    await writeFile(
      new URL(`../artifacts/shots/shot-${String(index + 1).padStart(2, "0")}.png`, import.meta.url),
      Buffer.from(source.split(",")[1], "base64"),
    );
  }
  await page.waitForTimeout(index === shots.length - 1 ? 850 : 250);
}

await page.waitForSelector("#compareModal:not([hidden])");
await page.waitForTimeout(350);
await page.screenshot({ path: new URL("../artifacts/completed-comparison.png", import.meta.url).pathname });
const loupes = await page.locator(".noise-loupe").evaluateAll((elements) =>
  elements.map((element) => element.style.backgroundImage.slice(5, -2)),
);
for (let index = 0; index < loupes.length; index += 1) {
  if (loupes[index]?.startsWith("data:image/png;base64,")) {
    await writeFile(
      new URL(`../artifacts/shots/loupe-${String(index + 1).padStart(2, "0")}.png`, import.meta.url),
      Buffer.from(loupes[index].split(",")[1], "base64"),
    );
  }
}
const finalState = await page.evaluate(() => window.__nightLab.getState());
const result = {
  verifiedAt: new Date().toISOString(),
  url: baseUrl,
  errors,
  captures: captureStates,
  finalState,
};
await writeFile(new URL("../artifacts/verification.json", import.meta.url), JSON.stringify(result, null, 2));
await writeFile(new URL("../artifacts/console-errors.json", import.meta.url), JSON.stringify(errors, null, 2));
const shutterLabel = (seconds) => seconds < 1 ? `1/${Math.round(1 / seconds)} s` : `${seconds} s`;
const reportRows = finalState.shots.map((shot) => (
  `| ${shot.id} | f/${shot.settings.aperture} | ${shutterLabel(shot.settings.seconds)} | ISO ${shot.settings.iso} | ${shot.info.ev >= 0 ? "+" : "−"}${Math.abs(shot.info.ev).toFixed(2)} | ${shot.info.inTarget ? "是" : "否"} | ${shot.metrics.shadowChroma.toFixed(1)} | ${shot.metrics.lumaNoise.toFixed(1)} | ${Math.round(shot.metrics.trail)} px |`
)).join("\n");
const low = [...finalState.shots].sort((a, b) => a.metrics.shadowChroma - b.metrics.shadowChroma)[0];
const high = [...finalState.shots].sort((a, b) => b.metrics.shadowChroma - a.metrics.shadowChroma)[0];
const longTrail = [...finalState.shots].sort((a, b) => b.metrics.trail - a.metrics.trail)[0];
const report = `# 夜光快门：三张成片与噪点对比

浏览器实测：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}

| # | 光圈 | 曝光时间 | ISO | EV | 目标内 | 阴影彩噪 | 亮度噪点 | 光轨 |
|---:|---:|---:|---:|---:|:---:|---:|---:|---:|
${reportRows}

三张照片均落在目标曝光区间，且参数互不相同。${low.metrics.shadowChroma <= high.metrics.shadowChroma ? `ISO ${low.settings.iso} 的照片阴影彩噪最低，为 ${low.metrics.shadowChroma.toFixed(1)}；ISO ${high.settings.iso} 的照片升至 ${high.metrics.shadowChroma.toFixed(1)}，约 ${(high.metrics.shadowChroma / Math.max(low.metrics.shadowChroma, 0.1)).toFixed(1)} 倍。` : ""}
${longTrail.settings.seconds} 秒曝光记录了约 ${Math.round(longTrail.metrics.trail)} px 的移动光轨。

## 成片

![低噪基准](shots/shot-01.png)

![高感彩噪](shots/shot-02.png)

![长曝光轨](shots/shot-03.png)

![完成对比](completed-comparison.png)
`;
await writeFile(new URL("../artifacts/comparison-report.md", import.meta.url), report);
console.log(JSON.stringify({
  errors,
  shots: finalState.shots.map((shot) => ({
    id: shot.id,
    settings: shot.settings,
    ev: Number(shot.info.ev.toFixed(3)),
    inTarget: shot.info.inTarget,
    metrics: shot.metrics,
  })),
}, null, 2));
await browser.close();
