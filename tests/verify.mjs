import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPORTS = path.join(ROOT, "artifacts", "exports");
const findings = [];

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const PORT = await getFreePort();
const BASE_URL = `http://127.0.0.1:${PORT}`;

function record(name, passed, detail) {
  findings.push({ name, passed, detail });
  assert.ok(passed, `${name}: ${detail}`);
}

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    chromium.executablePath(),
    "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
  ].filter(Boolean);
  const cacheRoot = "/home/hj/.cache/ms-playwright";
  if (await exists(cacheRoot)) {
    const versions = (await readdir(cacheRoot))
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .reverse();
    versions.forEach((version) => candidates.push(path.join(cacheRoot, version, "chrome-linux64", "chrome")));
  }
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error("找不到 Chromium，请先运行 npx playwright install chromium");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/index.html`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("本地预览服务启动超时");
}

async function waitReady(page) {
  await page.waitForFunction(() => document.body.dataset.ready === "true", null, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
}

function assertNoSafeZoneOverlap(item, safeZone, bbox) {
  const left = item.x - bbox.width / 2;
  const right = item.x + bbox.width / 2;
  const top = item.y - bbox.height / 2;
  const bottom = item.y + bbox.height / 2;
  const overlaps = !(
    right <= safeZone.x
    || left >= safeZone.x + safeZone.width
    || bottom <= safeZone.y
    || top >= safeZone.y + safeZone.height
  );
  assert.equal(overlaps, false, "文字仍与关键视觉中心相交");
}

async function dragElementTo(page, elementId, targetX, targetY) {
  const svgBox = await page.locator("#posterSvg").boundingBox();
  const itemBox = await page.locator(`[data-id="${elementId}"]`).boundingBox();
  assert.ok(svgBox && itemBox, `无法获取 ${elementId} 的位置`);
  const startX = itemBox.x + itemBox.width / 2;
  const startY = itemBox.y + itemBox.height / 2;
  const endX = svgBox.x + (targetX / 900) * svgBox.width;
  const endY = svgBox.y + (targetY / 1200) * svgBox.height;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(80);
}

async function getTextBBox(page, elementId) {
  return page.evaluate((id) => {
    const node = document.querySelector(`[data-id="${id}"]`);
    const box = node.getBBox();
    return { width: box.width, height: box.height };
  }, elementId);
}

async function renderCrop(page, bounds) {
  return page.evaluate(async (crop) => {
    const { pngBlob } = await window.posterEditor.createExportArtifacts();
    const url = URL.createObjectURL(pngBlob);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = crop.width;
    canvas.height = crop.height;
    canvas.getContext("2d").drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
    URL.revokeObjectURL(url);
    return canvas.toDataURL("image/png");
  }, bounds);
}

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: ROOT,
  stdio: "ignore",
});

let browser;
try {
  await mkdir(EXPORTS, { recursive: true });
  await waitForServer();
  browser = await chromium.launch({ headless: true, executablePath: await findChrome() });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.addInitScript(() => localStorage.clear());
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await waitReady(page);

  const initial = await page.evaluate(() => ({
    width: Number(document.querySelector("#posterSvg").getAttribute("width")),
    height: Number(document.querySelector("#posterSvg").getAttribute("height")),
    viewBox: document.querySelector("#posterSvg").getAttribute("viewBox"),
    itemCount: document.querySelectorAll("#elementLayer .poster-element").length,
    textCount: document.querySelectorAll("#elementLayer text").length,
    imageCount: document.querySelectorAll("image").length,
    fileInputs: document.querySelectorAll('input[type="file"]').length,
    stickerCards: document.querySelectorAll(".sticker-card").length,
    safeZone: window.posterEditor.getSafeZone(),
  }));
  record("预览逻辑尺寸", initial.width === 900 && initial.height === 1200,
    `${initial.width}×${initial.height}, viewBox=${initial.viewBox}`);
  record("纯矢量素材", initial.imageCount === 0 && initial.fileInputs === 0 && initial.stickerCards === 10,
    `images=${initial.imageCount}, fileInputs=${initial.fileInputs}, stickers=${initial.stickerCards}`);
  record("可拖拽对象齐全", initial.itemCount === 13 && initial.textCount === 5,
    `elements=${initial.itemCount}, text=${initial.textCount}`);

  await page.evaluate(() => window.posterEditor.selectItem("title-main"));
  await page.waitForTimeout(80);
  const titleBefore = await page.evaluate(() => {
    const item = window.posterEditor.getState().items.find((entry) => entry.id === "title-main");
    return { x: item.x, y: item.y };
  });
  await dragElementTo(page, "title-main", 450, 470);
  const titleAfter = await page.evaluate(() => {
    const item = window.posterEditor.getState().items.find((entry) => entry.id === "title-main");
    return { x: item.x, y: item.y };
  });
  const titleBox = await getTextBBox(page, "title-main");
  assertNoSafeZoneOverlap(titleAfter, initial.safeZone, titleBox);
  record("标题避让关键视觉中心", titleAfter.y !== titleBefore.y,
    `拖入中心后位置由 y=${titleBefore.y} 调整到 y=${titleAfter.y}`);

  await page.evaluate(() => window.posterEditor.selectItem("price-main"));
  const priceBefore = await page.evaluate(() => {
    const item = window.posterEditor.getState().items.find((entry) => entry.id === "price-main");
    return { x: item.x, y: item.y };
  });
  await dragElementTo(page, "price-main", 418, 862);
  const priceAfter = await page.evaluate(() => {
    const item = window.posterEditor.getState().items.find((entry) => entry.id === "price-main");
    return { x: item.x, y: item.y };
  });
  record("价格标签可拖拽", priceAfter.x !== priceBefore.x || priceAfter.y !== priceBefore.y,
    `位置 ${priceBefore.x},${priceBefore.y} → ${priceAfter.x},${priceAfter.y}`);

  await page.evaluate(() => {
    const input = document.querySelector("#rotation");
    input.value = "23";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const rotated = await page.evaluate(() => {
    const item = window.posterEditor.getState().items.find((entry) => entry.id === "price-main");
    return {
      rotation: item.rotation,
      transform: document.querySelector('[data-id="price-main"]').getAttribute("transform"),
    };
  });
  record("旋转可调", rotated.rotation === 23 && rotated.transform.includes("rotate(23)"),
    `rotation=${rotated.rotation}, transform=${rotated.transform}`);

  await page.evaluate(() => {
    const stroke = document.querySelector("#strokeWidth");
    stroke.value = "5";
    stroke.dispatchEvent(new Event("input", { bubbles: true }));
    stroke.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const stroked = await page.evaluate(() => ({
    state: window.posterEditor.getState().items.find((entry) => entry.id === "price-main").stroke.width,
    attr: document.querySelector('[data-id="price-main"] text').getAttribute("stroke-width"),
  }));
  record("描边可调", stroked.state === 5 && Number(stroked.attr) === 5,
    `state=${stroked.state}, SVG=${stroked.attr}`);

  await page.locator('label[for="shadowEnabled"]').click();
  const shadowOff = await page.evaluate(() => ({
    enabled: window.posterEditor.getState().items.find((entry) => entry.id === "price-main").shadow.enabled,
    filter: document.querySelector('[data-id="price-main"]').getAttribute("filter"),
  }));
  await page.locator('label[for="shadowEnabled"]').click();
  const shadowOn = await page.evaluate(() => ({
    enabled: window.posterEditor.getState().items.find((entry) => entry.id === "price-main").shadow.enabled,
    filter: document.querySelector('[data-id="price-main"]').getAttribute("filter"),
  }));
  record("阴影可开关", !shadowOff.enabled && shadowOff.filter === null && shadowOn.enabled && shadowOn.filter !== null,
    `关闭 filter=${shadowOff.filter}; 开启 filter=${shadowOn.filter}`);

  const countBeforeAdd = await page.evaluate(() => window.posterEditor.getState().items.length);
  await page.locator(".sticker-card").first().click();
  const afterAdd = await page.evaluate(() => ({
    count: window.posterEditor.getState().items.length,
    selectedType: window.posterEditor.getState().items.find((item) => (
      item.id === window.posterEditor.getState().selectedId
    ))?.type,
    imageCount: document.querySelectorAll("image").length,
  }));
  record("点击添加矢量贴纸", afterAdd.count === countBeforeAdd + 1 && afterAdd.selectedType === "sticker"
    && afterAdd.imageCount === 0, `elements=${afterAdd.count}, images=${afterAdd.imageCount}`);

  await page.reload({ waitUntil: "networkidle" });
  await waitReady(page);
  await page.evaluate(() => window.posterEditor.selectItem("sticker-gift-left"));
  await dragElementTo(page, "sticker-gift-left", 451, 441);
  await page.click('[data-layer-action="front"]');
  const zOrder = await page.evaluate(() => {
    const state = window.posterEditor.getState();
    const giftIndex = state.items.findIndex((item) => item.id === "sticker-gift-left");
    const burstIndex = state.items.findIndex((item) => item.id === "sticker-burst-hero");
    const rendered = [...document.querySelectorAll("#elementLayer [data-id]")].map((node) => node.dataset.id);
    const svgBox = document.querySelector("#posterSvg").getBoundingClientRect();
    const clientX = svgBox.x + (451 / 900) * svgBox.width;
    const clientY = svgBox.y + (441 / 1200) * svgBox.height;
    const hit = document.elementFromPoint(clientX, clientY)?.closest?.(".poster-element[data-id]")?.dataset.id;
    return {
      giftIndex,
      burstIndex,
      lastRendered: rendered.at(-1),
      renderedAbove: rendered.indexOf("sticker-gift-left") > rendered.indexOf("sticker-burst-hero"),
      hit,
    };
  });
  record("重排后遮挡顺序", zOrder.giftIndex > zOrder.burstIndex && zOrder.renderedAbove,
    `礼物 Z=${zOrder.giftIndex + 1}, 爆炸贴 Z=${zOrder.burstIndex + 1}, 最后渲染=${zOrder.lastRendered}`);
  record("重叠处命中顶层", zOrder.hit === "sticker-gift-left",
    `中心命中的元素=${zOrder.hit}`);

  const cropDataUrl = await renderCrop(page, { x: 210, y: 200, width: 480, height: 480 });
  await writeFile(path.join(EXPORTS, "zorder-gift-on-top.png"), Buffer.from(cropDataUrl.split(",")[1], "base64"));

  await page.reload({ waitUntil: "networkidle" });
  await waitReady(page);
  await page.screenshot({ path: path.join(EXPORTS, "final-editor.png"), fullPage: true });

  const downloadPromises = [];
  page.on("download", (download) => {
    const filename = download.suggestedFilename();
    assert.ok([".png", ".svg"].some((extension) => filename.endsWith(extension)), `意外下载文件名 ${filename}`);
    downloadPromises.push(download.saveAs(path.join(EXPORTS, filename)));
  });
  await page.click("#exportBoth");
  for (let attempt = 0; attempt < 80 && downloadPromises.length < 2; attempt += 1) {
    await page.waitForTimeout(100);
  }
  await page.waitForFunction(() => document.querySelector("#exportBoth").disabled === false, null, { timeout: 30000 });
  await Promise.all(downloadPromises);
  record("同时导出双格式", downloadPromises.length === 2,
    `downloads=${downloadPromises.length}`);

  const png = await readFile(path.join(EXPORTS, "discount-poster.png"));
  const pngWidth = png.readUInt32BE(16);
  const pngHeight = png.readUInt32BE(20);
  record("PNG 导出尺寸", pngWidth === 900 && pngHeight === 1200,
    `${pngWidth}×${pngHeight}, ${png.byteLength} bytes`);

  const svgText = await readFile(path.join(EXPORTS, "discount-poster.svg"), "utf8");
  const svgRoot = svgText.match(/<svg[^>]+width="(\d+)"[^>]+height="(\d+)"[^>]+viewBox="([^"]+)"/);
  const textNodes = (svgText.match(/<text\b/g) || []).length;
  const imageNodes = (svgText.match(/<image\b/g) || []).length;
  record("SVG 逻辑尺寸", Boolean(svgRoot) && svgRoot[1] === "900" && svgRoot[2] === "1200",
    svgRoot ? `${svgRoot[1]}×${svgRoot[2]}, viewBox=${svgRoot[3]}` : "未找到根尺寸");
  record("SVG 文字保持可编辑", textNodes >= 5, `text 元素=${textNodes}`);
  record("SVG 不含位图", imageNodes === 0, `image 元素=${imageNodes}`);
  record("SVG 包含海报文案",
    svgText.includes("双11 超级折扣季") && svgText.includes("全场 5 折起")
      && svgText.includes("到手价 ¥199 起"),
    "主标题、折扣价和到手价文案均存在");

  const svgPage = await context.newPage();
  await svgPage.setViewportSize({ width: 900, height: 1200 });
  await svgPage.goto(`${BASE_URL}/artifacts/exports/discount-poster.svg`, { waitUntil: "networkidle" });
  await svgPage.evaluate(() => document.fonts.ready);
  const standalone = await svgPage.evaluate(() => ({
    width: document.documentElement.getAttribute("width"),
    height: document.documentElement.getAttribute("height"),
    textCount: document.querySelectorAll("text").length,
    imageCount: document.querySelectorAll("image").length,
  }));
  await svgPage.locator("svg").screenshot({ path: path.join(EXPORTS, "svg-standalone-render.png") });
  record("独立 SVG 可渲染", standalone.width === "900" && standalone.height === "1200"
    && standalone.textCount >= 5 && standalone.imageCount === 0,
    `${standalone.width}×${standalone.height}, text=${standalone.textCount}, images=${standalone.imageCount}`);
  record("浏览器控制台无错误", consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.join(" | ") : "无错误");

  const verification = {
    generatedAt: new Date().toISOString(),
    canvas: { width: 900, height: 1200 },
    poster: {
      png: path.join(EXPORTS, "discount-poster.png"),
      svg: path.join(EXPORTS, "discount-poster.svg"),
      pngBytes: png.byteLength,
      svgBytes: Buffer.byteLength(svgText),
      textElements: textNodes,
      imageElements: imageNodes,
    },
    zOrder: zOrder,
    findings,
  };
  await writeFile(path.join(EXPORTS, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, findings, zOrder }, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
