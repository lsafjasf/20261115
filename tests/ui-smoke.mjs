import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mimeTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const filePath = path.join(root, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] ?? 'application/octet-stream',
    });
    response.end(data);
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The server needs a moment to bind the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Local preview server did not start');
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [];
  let downloadedFile = null;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('download', (download) => {
    downloadedFile = download;
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__stagePlanner));
  await page.waitForTimeout(300);

  let state = await page.evaluate(() => window.__stagePlanner.getState());
  assert.equal(state.valid, true, 'safe preset must start valid');
  assert.equal(state.conflictObjects.length, 0);
  assert.ok(state.minimumClearance >= state.safety);

  await page.click('#collisionPreset');
  state = await page.evaluate(() => window.__stagePlanner.getState());
  assert.equal(state.valid, false);
  assert.ok(state.conflictObjects.some((object) => object.id === 'pillar-2'));
  assert.ok(state.intervals.some((interval) => interval.obstacleId === 'pillar-2'));
  assert.equal(await page.locator('#exportButton').isDisabled(), true);
  assert.equal(await page.locator('[data-obstacle="pillar-2"].conflict-card').count(), 1);

  await page.click('#safePreset');
  const canvasBox = await page.locator('#stageCanvas').boundingBox();
  await page.mouse.move(
    canvasBox.x + (13.8 / 16) * canvasBox.width,
    canvasBox.y + (3 / 9) * canvasBox.height,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + (12 / 16) * canvasBox.width,
    canvasBox.y + (5 / 9) * canvasBox.height,
    { steps: 8 },
  );
  await page.mouse.up();
  state = await page.evaluate(() => window.__stagePlanner.getState());
  assert.ok(Math.abs(state.waypoints[3][0] - 12) < 0.1, 'fourth waypoint should be draggable');
  assert.ok(Math.abs(state.waypoints[3][1] - 5) < 0.1);

  await page.locator('#safety').fill('1.5');
  await page.waitForTimeout(120);
  state = await page.evaluate(() => window.__stagePlanner.getState());
  assert.equal(state.valid, false);
  assert.ok(state.conflictObjects.length >= 2);

  await page.click('#safePreset');
  state = await page.evaluate(() => window.__stagePlanner.getState());
  assert.equal(state.valid, true);
  assert.equal(state.safety, 0.8);

  await page.click('#previewButton');
  await page.waitForTimeout(650);
  state = await page.evaluate(() => window.__stagePlanner.getState());
  assert.equal(state.playing, true);
  assert.match(await page.locator('#currentTime').innerText(), /^00:0[0-9]\.\d$/);
  assert.ok((await page.locator('.audio-indicator').getAttribute('class')).includes('is-playing'));
  await page.click('#previewButton');

  await page.click('#exportButton');
  await page.waitForFunction(
    () => Boolean(window.__stagePlanner.getState().lastExport),
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(150);
  assert.ok(downloadedFile, 'browser should receive the WebM download');
  const outputPath = path.join(os.tmpdir(), downloadedFile.suggestedFilename());
  await downloadedFile.saveAs(outputPath);
  state = await page.evaluate(() => window.__stagePlanner.getState());
  assert.equal(downloadedFile.suggestedFilename(), 'live-axis-stage-preview.webm');
  assert.ok(fs.statSync(outputPath).size > 1_000_000, 'export should contain video data');
  assert.equal(state.lastExport.duration, 10);
  assert.equal(state.lastExport.width, 1920);
  assert.equal(state.lastExport.height, 1080);
  assert.deepEqual(errors, []);
  fs.rmSync(outputPath, { force: true });

  console.log('UI smoke test passed: safe shot, collision shot, drag, playback, 1080p export.');
} finally {
  await browser?.close();
  server.close();
}
