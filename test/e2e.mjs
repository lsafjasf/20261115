import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` → 期望 ${JSON.stringify(expected)} 实际 ${JSON.stringify(actual)}`}`);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(base);

// 1. 导入内置字幕条目
await page.click("#import-builtin-btn");
check("导入后字幕行数", await page.locator("#cue-table tbody tr").count(), 3);

const tcIn = (n) => page.locator(`#cue-table tbody tr:nth-child(${n}) .tc-in`).textContent();
const tcOut = (n) => page.locator(`#cue-table tbody tr:nth-child(${n}) .tc-out`).textContent();

// 2. 24fps 下三条字幕时间码
check("24fps 字幕1 入点", await tcIn(1), "00:00:00:12");
check("24fps 字幕1 出点", await tcOut(1), "00:00:02:12");
check("24fps 字幕2 入点", await tcIn(2), "00:00:03:00");
check("24fps 字幕2 出点", await tcOut(2), "00:00:05:12");
check("24fps 字幕3 入点", await tcIn(3), "00:00:06:00");
check("24fps 字幕3 出点", await tcOut(3), "00:00:09:00");

// 3. 拖动时间轴到指定帧
async function dragToFrame(frame) {
  const box = await page.locator("#timeline-canvas").boundingBox();
  const width = await page.locator("#timeline-canvas").evaluate((c) => c.width);
  const pad = 12;
  const xCss = (pad + (frame / 239) * (width - pad * 2)) * (box.width / width);
  await page.mouse.move(box.x + xCss, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + xCss + 1, box.y + box.height / 2);
  await page.mouse.up();
}
const readout = () => page.locator("#playhead-readout").textContent();
const activeRows = () => page.locator("#cue-table tbody tr.active-cue").count();

await dragToFrame(30);
check("拖到帧30 读数", await readout(), "帧 30 · 00:00:01:06");
check("帧30 命中字幕1", await activeRows(), 1);
check("帧30 高亮的是字幕1", await page.locator("tr.active-cue td:first-child").textContent(), "1");

await dragToFrame(60); // 出点为半开区间，帧60 不再显示字幕1
check("帧60(出点) 无字幕命中", await activeRows(), 0);

await dragToFrame(72); // 字幕2 入点
check("帧72(入点) 命中字幕2", await page.locator("tr.active-cue td:first-child").textContent(), "2");

await dragToFrame(215);
check("帧215 命中字幕3", await page.locator("tr.active-cue td:first-child").textContent(), "3");

// 4. 切换 30fps：帧号不变，时间码重算
await page.click("#fps-30");
check("30fps 字幕1 入点", await tcIn(1), "00:00:00:12");
check("30fps 字幕1 出点", await tcOut(1), "00:00:02:00");
check("30fps 字幕2 入点", await tcIn(2), "00:00:02:12");
check("30fps 字幕2 出点", await tcOut(2), "00:00:04:12");
check("30fps 字幕3 入点", await tcIn(3), "00:00:04:24");
check("30fps 字幕3 出点", await tcOut(3), "00:00:07:06");
check("30fps 播放头读数重算", await readout(), "帧 215 · 00:00:07:05");

// 5. 字幕重叠阻止保存
await page.locator("tr:nth-child(2) .cue-in").fill("50");
await page.locator("tr:nth-child(2) .cue-in").press("Tab");
check("重叠时保存被禁用", await page.locator("#save-btn").isDisabled(), true);
check("重叠提示", (await page.locator("#save-status").textContent()).includes("重叠"), true);
check("重叠行高亮", await page.locator("tr.conflict").count(), 2);

// 6. 修复重叠后保存成功
await page.locator("tr:nth-child(2) .cue-in").fill("72");
await page.locator("tr:nth-child(2) .cue-in").press("Tab");
check("修复后保存可用", await page.locator("#save-btn").isDisabled(), false);
await page.click("#save-btn");
check("保存状态", await page.locator("#save-status").textContent(), "已保存");

// 7. 导出 WebVTT（30fps 时间戳）
const downloadPromise = page.waitForEvent("download");
await page.click("#export-vtt-btn");
const download = await downloadPromise;
check("下载文件名", download.suggestedFilename(), "subtitles-30fps.vtt");
const preview = await page.locator("#vtt-preview").textContent();
check("VTT 头部", preview.startsWith("WEBVTT"), true);
check("VTT 字幕1 时间戳", preview.includes("00:00:00.400 --> 00:00:02.000"), true);
check("VTT 字幕2 时间戳", preview.includes("00:00:02.400 --> 00:00:04.400"), true);
check("VTT 字幕3 时间戳", preview.includes("00:00:04.800 --> 00:00:07.200"), true);
check("VTT 文本完整", ["第一幕：小球登场", "它越弹越高", "落幕，感谢观看"].every((t) => preview.includes(t)), true);

// 8. 切回 24fps 复核
await page.click("#fps-24");
check("切回24fps 字幕3 出点", await tcOut(3), "00:00:09:00");
await page.click("#export-vtt-btn");
check("24fps VTT 字幕3 时间戳", (await page.locator("#vtt-preview").textContent()).includes("00:00:06.000 --> 00:00:09.000"), true);

await browser.close();
server.close();
console.log(failures === 0 ? "\n全部通过 ✅" : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
