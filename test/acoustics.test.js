import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MODES, SPEAKER_IDS, SPEAKERS, HEX_VERTICES, computeField, coverageGrid,
  insideHex, delayMs, gainAt, QUAD_CHANNEL_INDEX, HEX_RADIUS
} from '../js/acoustics.js';

const CENTER = { x: 0, y: 0 };

test('六边形几何：六个顶点等距，扬声器在地毯内', () => {
  assert.equal(HEX_VERTICES.length, 6);
  for (const v of HEX_VERTICES) {
    assert.ok(Math.abs(Math.hypot(v.x, v.y) - HEX_RADIUS) < 1e-9);
  }
  for (const id of SPEAKER_IDS) {
    assert.equal(insideHex(SPEAKERS[id]), true);
  }
  assert.equal(insideHex({ x: HEX_RADIUS * 2, y: 0 }), false);
});

test('延迟随距离单调增加，增益随距离衰减', () => {
  const near = { x: SPEAKERS.FL.x, y: SPEAKERS.FL.y };
  const far = { x: -SPEAKERS.FL.x, y: -SPEAKERS.FL.y };
  assert.ok(delayMs(near, SPEAKERS.FL) < delayMs(far, SPEAKERS.FL));
  assert.ok(gainAt(near, SPEAKERS.FL) > gainAt(far, SPEAKERS.FL));
  assert.ok(delayMs(near, SPEAKERS.FL) >= 0);
  assert.ok(gainAt(near, SPEAKERS.FL) <= 1);
});

test('同一位置切换模式：物理延迟/增益不变，仅激活集合变化', () => {
  const stereo = computeField(CENTER, 'stereo');
  const binaural = computeField(CENTER, 'binaural');
  const quad = computeField(CENTER, 'quad');
  for (const id of SPEAKER_IDS) {
    const pick = (f) => f.speakers.find((s) => s.id === id);
    assert.equal(pick(stereo).delayMs, pick(binaural).delayMs);
    assert.equal(pick(binaural).delayMs, pick(quad).delayMs);
    assert.equal(pick(stereo).gain, pick(quad).gain);
  }
  assert.deepEqual(stereo.speakers.filter((s) => s.active).map((s) => s.id),
    MODES.stereo.activeSpeakers);
});

test('声道数量：立体声与双耳为 2，四点环绕为 4', () => {
  assert.equal(computeField(CENTER, 'stereo').outputChannels, 2);
  assert.equal(computeField(CENTER, 'binaural').outputChannels, 2);
  assert.equal(computeField(CENTER, 'quad').outputChannels, 4);
  assert.equal(MODES.stereo.outputChannels, 2);
  assert.equal(MODES.binaural.outputChannels, 2);
  assert.equal(MODES.quad.outputChannels, 4);
});

test('各模式活跃扬声器数量正确', () => {
  assert.equal(MODES.stereo.activeSpeakers.length, 2);
  assert.equal(MODES.binaural.activeSpeakers.length, 4);
  assert.equal(MODES.quad.activeSpeakers.length, 4);
  const quadField = computeField(CENTER, 'quad');
  assert.equal(quadField.speakers.every((s) => s.active), true);
});

test('四点环绕通道映射覆盖 0..3 且唯一', () => {
  const indexes = Object.values(QUAD_CHANNEL_INDEX).sort((a, b) => a - b);
  assert.deepEqual(indexes, [0, 1, 2, 3]);
});

test('SPL 覆盖网格全部落在六边形内且数值有限', () => {
  const grid = coverageGrid(18, 'quad');
  assert.ok(grid.cells.length > 100);
  for (const cell of grid.cells) {
    assert.equal(insideHex(cell), true);
    assert.ok(Number.isFinite(cell.spl));
    assert.ok(cell.spl > 40 && cell.spl < 120);
  }
});

test('模式实测对比：四点源叠加 SPL 高于双点立体声', () => {
  const stereo = computeField(CENTER, 'stereo');
  const quad = computeField(CENTER, 'quad');
  assert.ok(quad.combinedSpl > stereo.combinedSpl);
  assert.ok(Math.abs(quad.combinedSpl - stereo.combinedSpl -
    10 * Math.log10(2)) < 1e-9);
});
