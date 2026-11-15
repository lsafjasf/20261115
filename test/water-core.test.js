'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/water-core.js');

test('normalizeParams 夹紧数值并丢弃非法颜色与未知字段', () => {
  const p = C.normalizeParams({
    rippleScale: 99,
    direction: -40,
    fogDensity: -1,
    reflection: 5,
    waterColor: 'red',
    fogColor: '#abc',
    quality: 'ultra',
    hacker: 'x',
  });
  assert.equal(p.rippleScale, 3.0);
  assert.equal(p.direction, 0);
  assert.equal(p.fogDensity, 0);
  assert.equal(p.reflection, 1);
  assert.equal(p.waterColor, C.makeDefaults().waterColor);
  assert.equal(p.fogColor, C.makeDefaults().fogColor);
  assert.equal(p.quality, 'auto');
  assert.equal('hacker' in p, false);
});

test('三组预设 toJSON -> fromJSON 完全一致（重载一致性）', () => {
  const presets = C.makePresets();
  assert.equal(presets.length, 3);
  for (const preset of presets) {
    const json = C.toJSON(preset.params);
    const reloaded = C.fromJSON(json);
    assert.deepEqual(reloaded, C.normalizeParams(preset.params));
    assert.equal(reloaded.schema, C.SCHEMA);
  }
});

test('fromJSON 拒绝空串、坏 JSON 与错误 schema 版本', () => {
  assert.throws(() => C.fromJSON(''), /空配置/);
  assert.throws(() => C.fromJSON('{oops'), /JSON 解析失败/);
  assert.throws(() => C.fromJSON('{"schema":"water-panel/v9"}'), /不支持的配置版本/);
  // 无 schema 字段的旧/外部 JSON 仍可按默认补齐载入。
  assert.doesNotThrow(() => C.fromJSON('{"reflection":0.4}'));
  assert.equal(C.fromJSON('{"reflection":0.4}').reflection, 0.4);
});

test('质量策略：低帧率降档，冷却期内不抖动', () => {
  let t = 0;
  const policy = C.createQualityPolicy({
    now: () => t,
    cooldownMs: 1000,
    windowSize: 5,
    initial: 'high',
  });
  for (let i = 0; i < 6; i += 1) {
    t += 16;
    policy.sample(20); // 全部在冷却窗口内
  }
  assert.equal(policy.getTier(), 'high'); // 冷却未满，不降档
  t += 1000;
  policy.sample(20);
  assert.equal(policy.getTier(), 'medium');
  t += 10;
  policy.sample(20);
  assert.equal(policy.getTier(), 'medium'); // 冷却期锁定，无闪烁跳档
});

test('质量策略：继续恶化再降一档，持续高帧率才升档', () => {
  let t = 0;
  const policy = C.createQualityPolicy({
    now: () => t,
    cooldownMs: 1000,
    windowSize: 5,
    initial: 'high',
  });
  t += 2000;
  for (let i = 0; i < 6; i += 1) policy.sample(20);
  assert.equal(policy.getTier(), 'medium');
  t += 2000;
  for (let i = 0; i < 6; i += 1) policy.sample(22);
  assert.equal(policy.getTier(), 'low');

  // 窗口未满不允许升档
  t += 2000;
  for (let i = 0; i < 3; i += 1) policy.sample(60);
  assert.equal(policy.getTier(), 'low');
  t += 2000;
  for (let i = 0; i < 6; i += 1) policy.sample(60);
  assert.equal(policy.getTier(), 'medium');
});

test('质量渲染设置只影响 dpr/octaves，颜色字段不出现在设置中', () => {
  const low = C.qualityRenderSettings('low', 3);
  const high = C.qualityRenderSettings('high', 3);
  assert.ok(low.octaves < high.octaves);
  assert.ok(low.dpr < high.dpr);
  assert.equal(low.dpr, C.QUALITY_TIERS.low.dprCap);
  for (const key of ['waterColor', 'fogColor']) {
    assert.equal(key in low, false);
    assert.equal(key in high, false);
  }
});

test('色相与帧比较工具正确', () => {
  // 纯红 hue=0，纯绿 hue=120，纯蓝 hue=240
  assert.equal(C.rgbToHue(1, 0, 0), 0);
  assert.equal(C.rgbToHue(0, 1, 0), 120);
  assert.equal(C.rgbToHue(0, 0, 1), 240);
  assert.equal(C.hueDistance(350, 10), 20);
  const a = new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 255]);
  const b = new Uint8ClampedArray([12, 20, 28, 255, 10, 20, 30, 255]);
  const cmp = C.compareFrames(a, b);
  assert.equal(cmp.maxAbsDiff, 2);
  assert.equal(cmp.changedChannels, 2);
  assert.ok(cmp.meanAbsDiff > 0 && cmp.meanAbsDiff < 1);
});

test('帧色相只取决于颜色通道，质量差异不改变整体色相', () => {
  // 两组像素整体比例一致 -> hue 相同（亮度/采样数差异不影响色相）
  const frame1 = new Uint8ClampedArray([200, 100, 50, 255, 200, 100, 50, 255]);
  const frame2 = new Uint8ClampedArray([100, 50, 25, 255]);
  const h1 = C.frameHue(frame1);
  const h2 = C.frameHue(frame2);
  assert.equal(C.hueDistance(h1, h2), 0);
});
