import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const testDir = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(testDir, "..");
const artifactsDir = join(rootDir, "artifacts");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function startServer() {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const requested = pathname === "/" ? "/index.html" : pathname;
    const filePath = normalize(join(rootDir, requested));
    if (!filePath.startsWith(rootDir)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveServer({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function setRange(page, key, value) {
  const input = page.locator(`#paramControls input[data-param="${key}"]`);
  await input.evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function chooseEffect(page, type) {
  await page.locator(`.effect-item[data-type="${type}"] .effect-select`).click();
}

async function downloadScreenshot(page, filename) {
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#screenshotButton").click();
  const download = await downloadPromise;
  const path = join(artifactsDir, filename);
  await download.saveAs(path);
  return path;
}

async function main() {
  await mkdir(artifactsDir, { recursive: true });
  const { server, origin } = await startServer();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"],
  });
  const consoleErrors = [];
  const page = await browser.newPage({
    viewport: { width: 1440, height: 980 },
    deviceScaleFactor: 1,
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.__prismLab));
    await page.waitForFunction(
      () => Number(document.querySelector("#fpsValue").textContent) > 0,
    );

    const initial = await page.evaluate(() => window.__prismLab.getState());
    assert(
      initial.chain.map((effect) => effect.type).join(",") === "ripple,fog,dots",
      "The initial chain should contain ripple, fog and dots.",
    );

    await chooseEffect(page, "ripple");
    await setRange(page, "amplitude", 0.072);
    await setRange(page, "frequency", 34);
    await setRange(page, "speed", 1.9);
    await chooseEffect(page, "fog");
    await setRange(page, "density", 0.63);
    await setRange(page, "scale", 3.1);
    await setRange(page, "drift", 0.9);
    await chooseEffect(page, "dots");
    await setRange(page, "cell", 10);
    await setRange(page, "strength", 0.7);
    await setRange(page, "contrast", 1.3);

    await page.locator('.effect-item[data-type="ripple"] [data-action="down"]').click();
    await page.locator('.effect-item[data-type="ripple"] [data-action="down"]').click();
    const beforeState = await page.evaluate(() => window.__prismLab.getState());
    assert(
      beforeState.chain.map((effect) => effect.type).join(",") === "fog,dots,ripple",
      "The UI reorder should produce fog, dots, ripple.",
    );

    await page.evaluate(() => window.__prismLab.freeze(2.75));
    const beforePath = await downloadScreenshot(page, "effect-chain-before-reload.png");
    const beforeBuffer = await readFile(beforePath);

    await page.locator("#saveName").fill("三效验证链 · 波纹雾气点阵");
    await page.locator("#saveForm button[type=submit]").click();
    const savedEntry = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("prism-lab.effect-chains.v1"));
      return saved[0];
    });
    assert(savedEntry, "The chain should be written to localStorage.");
    assert(
      JSON.stringify(savedEntry.chain) === JSON.stringify(beforeState.chain),
      "Saved params and order should match the live chain.",
    );

    await page.locator("#resetChainButton").click();
    await chooseEffect(page, "dots");
    await setRange(page, "strength", 1);
    const mutated = await page.evaluate(() => window.__prismLab.getState());
    assert(
      JSON.stringify(mutated.chain) !== JSON.stringify(beforeState.chain),
      "Reset and parameter edits should mutate the visible chain before reload.",
    );

    await page.locator(".saved-item .load-button").first().click();
    const afterState = await page.evaluate(() => window.__prismLab.getState());
    assert(
      JSON.stringify(afterState.chain) === JSON.stringify(beforeState.chain),
      "Reloaded params and order should exactly match the saved chain.",
    );

    const afterPath = await downloadScreenshot(page, "effect-chain-after-reload.png");
    const afterBuffer = await readFile(afterPath);
    assert(afterBuffer.equals(beforeBuffer), "Screenshots before save and after reload should be byte-identical.");

    const baseline = await page.evaluate(() => window.__prismLab.captureDataURL());
    await page.locator('.effect-item[data-type="ripple"] [data-action="toggle"]').click();
    const withoutRipple = await page.evaluate(() => window.__prismLab.captureDataURL());
    assert(withoutRipple !== baseline, "Disabling ripple should visibly change the frame.");
    await page.locator('.effect-item[data-type="ripple"] [data-action="toggle"]').click();
    const rippleRestored = await page.evaluate(() => window.__prismLab.captureDataURL());
    assert(
      rippleRestored === baseline,
      "Re-enabling ripple should rebuild from the base scene without a residual mask.",
    );

    const fps = await page.locator("#fpsValue").textContent();
    const fontLoaded = await page.evaluate(() => document.fonts.check('12px "Noto Sans SC"'));
    assert(Number(fps) > 0, "FPS should display a positive numeric value.");
    assert(fontLoaded, "The bundled Chinese font should be active.");
    assert(consoleErrors.length === 0, `Unexpected browser errors: ${consoleErrors.join(" | ")}`);

    await page.screenshot({ path: join(artifactsDir, "sandbox-verified.png"), fullPage: true });
    const beforeHash = hash(beforeBuffer);
    const afterHash = hash(afterBuffer);
    const report = {
      passed: true,
      verifiedAt: new Date().toISOString(),
      browser: "Chromium via Playwright",
      orderBeforeSave: beforeState.chain.map((effect) => effect.type),
      orderAfterReload: afterState.chain.map((effect) => effect.type),
      parametersPreserved: afterState.chain.every(
        (effect, index) => JSON.stringify(effect.params) === JSON.stringify(beforeState.chain[index].params),
      ),
      screenshots: {
        before: beforePath,
        after: afterPath,
        sha256Before: beforeHash,
        sha256After: afterHash,
        byteIdentical: beforeBuffer.equals(afterBuffer),
      },
      maskReset: {
        disableChangedFrame: withoutRipple !== baseline,
        reenableMatchedBaseline: rippleRestored === baseline,
      },
      fps,
      chineseFontLoaded: fontLoaded,
      consoleErrors,
    };
    await writeFile(
      join(artifactsDir, "verification.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
