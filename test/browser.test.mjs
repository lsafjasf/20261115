import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';

const ARTIFACTS = path.resolve('artifacts');
await mkdir(ARTIFACTS, { recursive: true });

const server = spawn(process.execPath, [path.resolve('tools/serve.mjs')], {
  cwd: path.resolve('.'),
  env: { ...process.env, PORT: '8137' },
  stdio: 'ignore',
  detached: true,
});
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    const response = await fetch('http://127.0.0.1:8137/index.html');
    if (response.ok) break;
  } catch {
    await delay(150);
  }
}

// Minimal Matroska/WebM scanner: walk EBML elements, collect SegmentInfo
// Duration (scaled by TimecodeScale) and track entry UIDs to prove the
// exported file really contains video + audio.
function readVint(buffer, offset) {
  const first = buffer[offset];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  let value = first & (0x7f >> (length - 1));
  for (let i = 1; i < length; i += 1) value = value * 256 + buffer[offset + i];
  return { value, length };
}

// Recursive EBML walker. Matroska element IDs are 1-4 bytes with marker
// bits 1xxx / 01xx / 001x / 0001 1xxx; unknown-size elements are skipped.
const EBML = {
  segment: Buffer.from([0x18, 0x53, 0x80, 0x67]),
  info: Buffer.from([0x15, 0x49, 0xa9, 0x66]),
  tracks: Buffer.from([0x16, 0x54, 0xae, 0x6b]),
  trackEntry: Buffer.from([0xae]),
  cluster: Buffer.from([0x1f, 0x43, 0xb6, 0x75]),
  clusterTimecode: Buffer.from([0xe7]),
  simpleBlock: Buffer.from([0xa3]),
  timecodeScale: Buffer.from([0x2a, 0xd7, 0xb1]),
  duration: Buffer.from([0x44, 0x89]),
  trackType: Buffer.from([0x83]),
  codecId: Buffer.from([0x86]),
};

function idLengthAt(buffer, offset) {
  const byte = buffer[offset];
  if (byte >= 0x80) return 1;
  if (byte >= 0x40) return 2;
  if (byte >= 0x20) return 3;
  if (byte >= 0x10) return 4;
  return 0;
}

function walkChildren(buffer, start, end, visit) {
  let offset = start;
  while (offset + 2 < end) {
    const idLen = idLengthAt(buffer, offset);
    if (!idLen) break;
    const id = buffer.subarray(offset, offset + idLen);
    const size = readVint(buffer, offset + idLen);
    const bodyStart = offset + idLen + size.length;
    if (bodyStart > end) break;
    const unknownSize = size.value === (2 ** (7 * size.length) - 1);
    const bodyEnd = unknownSize ? end : bodyStart + size.value;
    if (bodyEnd > end) break;
    visit(id, bodyStart, bodyEnd);
    offset = bodyEnd;
  }
}

function parseWebm(buffer) {
  let timecodeScale = 1_000_000;
  let durationRaw = null;
  const tracks = [];
  const clusterTimecodesMs = [];
  let simpleBlockCount = 0;
  let segmentRange = null;

  walkChildren(buffer, 0, buffer.length, (id, start, end) => {
    if (id.equals(EBML.segment)) segmentRange = [start, end];
  });
  assert.ok(segmentRange, 'WebM Segment element not found');

  walkChildren(buffer, segmentRange[0], segmentRange[1], (id, start, end) => {
    if (id.equals(EBML.info)) {
      walkChildren(buffer, start, end, (childId, childStart, childEnd) => {
        if (childId.equals(EBML.timecodeScale)) {
          timecodeScale = Number(buffer.readUIntBE(childStart, childEnd - childStart));
        } else if (childId.equals(EBML.duration)) {
          durationRaw = childEnd - childStart === 4
            ? buffer.readFloatBE(childStart)
            : buffer.readDoubleBE(childStart);
        }
      });
    } else if (id.equals(EBML.tracks)) {
      walkChildren(buffer, start, end, (childId, childStart, childEnd) => {
        if (!childId.equals(EBML.trackEntry)) return;
        const entry = { type: null, codec: '' };
        walkChildren(buffer, childStart, childEnd, (leafId, leafStart, leafEnd) => {
          if (leafId.equals(EBML.trackType)) entry.type = buffer[leafStart];
          if (leafId.equals(EBML.codecId)) {
            entry.codec = buffer.subarray(leafStart, leafEnd).toString();
          }
        });
        tracks.push(entry);
      });
    } else if (id.equals(EBML.cluster)) {
      const scanCluster = (from, to) => {
        walkChildren(buffer, from, to, (childId, childStart, childEnd) => {
          if (childId.equals(EBML.clusterTimecode)) {
            clusterTimecodesMs.push(
              buffer.readIntBE(childStart, childEnd - childStart));
          } else if (childId.equals(EBML.simpleBlock)) {
            simpleBlockCount += 1;
          } else if (childId.equals(EBML.cluster)) {
            scanCluster(childStart, childEnd);
          }
        });
      };
      scanCluster(start, end);
    }
  });

  return {
    timecodeScale,
    durationS: durationRaw === null ? null : (durationRaw * timecodeScale) / 1e9,
    clusterTimecodesMs,
    lastClusterTimecodeMs: clusterTimecodesMs.at(-1) ?? null,
    simpleBlockCount,
    tracks,
  };
}

const profileDir = await mkdtemp(path.join(os.tmpdir(), 'cut-editor-'));
const context = await chromium.launchPersistentContext(profileDir, {
  viewport: { width: 1360, height: 1180 },
  args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'],
});
await context.route('**/*', async (route) => {
  const response = await route.fetch();
  await route.fulfill({ response, headers: {
    ...response.headers(),
    'cache-control': 'no-store, max-age=0',
  } });
});
const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console.error]', msg.text());
});
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

await page.goto(`http://127.0.0.1:8137/index.html?v=${Date.now()}`,
  { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__editor !== undefined);

const results = { checks: [] };
function record(name, ok, detail = '') {
  results.checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail ? ` (${detail})` : ''}`);
}

// 1. Initial three-cut validation against action peaks.
let validation = await page.evaluate(() => window.__editor.validate());
record('three cut points present', validation.length === 3);
record('all cuts aligned to peaks initially',
  validation.every((cut) => cut.status === 'ok' && cut.distance === 0),
  validation.map((cut) => `f${cut.frame}:${cut.distance}`).join(', '));

// 2. Drag emulation: move cut 2 three frames off and confirm the warning,
// then snap back. Cut 2 starts at frame 180.
await page.evaluate(() => window.__editor.moveCut(1, 183));
let warnState = await page.evaluate(() => ({
  distance: window.__editor.distance(1),
  report: window.__editor.validate()[1],
}));
record('3-frame offset is flagged (>2 frame tolerance)',
  warnState.distance === 3 && warnState.report.status === 'warn',
  `distance=${warnState.distance}`);
await page.click('#snapBtn');
validation = await page.evaluate(() => window.__editor.validate());
record('snap restores peak alignment',
  validation.every((cut) => cut.status === 'ok'),
  validation.map((cut) => cut.frame).join(','));

// 3. Hard-cut shot switching first (default timeline is all hard cuts).
await page.evaluate(() => {
  window.__editor.state.cuts.forEach((cut) => { cut.mode = 'hard'; });
  window.__editor.refresh();
});
const frameSamples = await page.evaluate(() => {
  const frames = [0, 89, 90, 179, 180, 269, 270, 359];
  return frames.map((frame) => ({
    frame,
    weights: window.__editor.weightsAt(frame / 30),
  }));
});
const expectedShots = [0, 0, 1, 1, 2, 2, 0, 0];
const actualShots = frameSamples.map((sample) =>
  sample.weights.findIndex((weight) => weight >= 0.999));
record('cut frames switch output shot wide-medium-close-wide',
  JSON.stringify(actualShots) === JSON.stringify(expectedShots),
  actualShots.join(','));

// 5. Offline audio continuity: first the all-hard-cut mix.
await page.click('#audioBtn');
await page.waitForFunction(() => window.__lastAudioReport !== undefined);
const audioHard = await page.evaluate(() => window.__lastAudioReport);
record('offline mix renders 12 seconds',
  Math.abs(audioHard.durationS - 12) < 0.05, `${audioHard.durationS}s`);
record('no silent gaps in hard-cut mix',
  audioHard.silentGapCount === 0,
  `min RMS ${audioHard.minRmsDb.toFixed(1)} dBFS`);
record('audio level continuous around every hard cut',
  audioHard.aroundCuts.every((cut) =>
    cut.beforeDb > -60 && cut.atDb > -60 && cut.afterDb > -60),
  audioHard.aroundCuts.map((cut) =>
    `${cut.beforeDb.toFixed(0)}/${cut.atDb.toFixed(0)}/${cut.afterDb.toFixed(0)}`).join(' | '));

// Enable the crossfade, re-check audio and verify blend weights.
await page.evaluate(() => window.__editor.toggleMode(1));
const blend = await page.evaluate((fps) => {
  const center = window.__editor.weightsAt(180 / fps);
  const edge = window.__editor.weightsAt(176.4 / fps);
  return { center, edge };
}, 30);
record('crossfade center blends 50/50',
  Math.abs(blend.center[1] - 0.5) < 1e-9 && Math.abs(blend.center[2] - 0.5) < 1e-9,
  JSON.stringify(blend.center));
record('crossfade weights sum to one',
  blend.center.reduce((a, b) => a + b, 0) === 1 &&
  Math.abs(blend.edge.reduce((a, b) => a + b, 0) - 1) < 1e-9);
await page.click('#audioBtn');
await page.waitForFunction(
  (previous) => window.__lastAudioReport !== previous,
  audioHard,
);
const audioFade = await page.evaluate(() => window.__lastAudioReport);
record('no silent gaps with crossfade enabled',
  audioFade.silentGapCount === 0,
  `min RMS ${audioFade.minRmsDb.toFixed(1)} dBFS`);

// 6. Real MediaRecorder export to WebM. Leave the crossfade on so the
// exported take exercises both transition types.
await page.click('#exportBtn');
await page.waitForFunction(() => window.__lastExport !== undefined, { timeout: 60_000 });
const exportInfo = await page.evaluate(async () => {
  const exp = window.__lastExport;
  const bytes = new Uint8Array(await exp.blob.arrayBuffer());
  return {
    type: exp.blob.type,
    size: exp.blob.size,
    bytes: Array.from(bytes),
    sampledShots: exp.sampledShots,
  };
});
const webmBuffer = Buffer.from(exportInfo.bytes);
await writeFile(path.join(ARTIFACTS, 'cut-12s.webm'), webmBuffer);
const parsed = parseWebm(webmBuffer);
record('exported blob is WebM',
  exportInfo.type.startsWith('video/webm'), exportInfo.type);
record('WebM contains video and audio tracks',
  parsed.tracks.some((track) => track.type === 1) &&
  parsed.tracks.some((track) => track.type === 2),
  parsed.tracks.map((track) => `${track.type}:${track.codec}`).join(', '));
record('WebM duration covers ~12 seconds',
  parsed.lastClusterTimecodeMs !== null &&
  parsed.lastClusterTimecodeMs >= 11_200 && parsed.lastClusterTimecodeMs <= 12_800,
  `last cluster @ ${parsed.lastClusterTimecodeMs}ms, blocks=${parsed.simpleBlockCount}`);
record('export frame samples cover all three shots',
  new Set(exportInfo.sampledShots.flatMap((sample) =>
    sample.weights.map((weight, shotIndex) => (weight > 0 ? shotIndex : -1))
      .filter((shotIndex) => shotIndex >= 0))).size >= 3,
  `${exportInfo.sampledShots.length} samples`);

// 7. Visual artifacts: source monitors and a frame at each segment.
await page.screenshot({ path: path.join(ARTIFACTS, 'ui-full.png'), fullPage: true });
for (const frame of [15, 120, 225, 320]) {
  await page.evaluate((f) => window.__editor.setFrame(f), frame);
  await page.waitForTimeout(60);
  await page.locator('#preview').screenshot({
    path: path.join(ARTIFACTS, `output-frame-${frame}.png`),
  });
}
const pixelCheck = await page.evaluate(() => {
  const canvas = document.getElementById('preview');
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let nonBlack = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] + data[i + 1] + data[i + 2] > 30) nonBlack += 1;
  }
  return { nonBlack, total: data.length / 4 };
});
record('preview canvas renders non-empty frames',
  pixelCheck.nonBlack / pixelCheck.total > 0.5,
  `${(pixelCheck.nonBlack / pixelCheck.total * 100).toFixed(1)}% lit pixels`);

await writeFile(path.join(ARTIFACTS, 'verification-report.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    cuts: validation,
    audioHard,
    audioFade,
    webm: {
      mimeType: exportInfo.type,
      sizeBytes: exportInfo.size,
      parsed,
      sampledShots: exportInfo.sampledShots,
    },
    checks: results.checks,
  }, null, 2));

const failed = results.checks.filter((check) => !check.ok);
await context.close();
process.kill(-server.pid);
if (failed.length) {
  console.error(`\n${failed.length} browser check(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${results.checks.length} browser checks passed.`);
