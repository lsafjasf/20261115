/*
 * test-determinism.mjs — 验证「同一参数重载后音序完全一致」。
 * 运行：node test-determinism.mjs
 */
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const SIM = require('./sim.js');

const tubes = SIM.defaultTubeGeometry().map(t => ({ x: t.x, y: t.midY }));
const MASK_WINDOW = 0.22;
const MAX_POLYPHONY = 5;

function fullSequence(composition) {
  const raw = SIM.simulateLoop(composition, tubes);
  return SIM.applyMasking(raw, MASK_WINDOW, MAX_POLYPHONY);
}

// 事件序列规范化（避免浮点尾差造成误报：时间量化到 0.1ms，力度量化到 1e-6）
function normalize(events) {
  return events.map(e => ({
    t: Math.round(e.time * 10000),
    chime: e.chime,
    v: Math.round(e.velocity * 1e6)
  }));
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('风铃确定性测试（12 秒循环）\n');

const composition = SIM.defaultComposition();
assert.equal(composition.sources.length, 6, '默认作品应有六组风源');

// 1. 同一参数连续模拟两次 => 完全一致
const seq1 = normalize(fullSequence(composition));
const seq2 = normalize(fullSequence(composition));
check('同一参数重复模拟，音序完全一致', () => {
  assert.deepEqual(seq1, seq2);
  assert.ok(seq1.length > 0, '默认作品应产生触发事件');
});

// 2. 序列化 -> 反序列化（模拟保存后重载）=> 完全一致
check('保存 JSON 后重载，音序完全一致', () => {
  const json = JSON.stringify(composition);
  const reloaded = JSON.parse(json);
  const seqReloaded = normalize(fullSequence(reloaded));
  assert.deepEqual(seq1, seqReloaded);
});

// 3. 所有事件都在 12 秒循环内，且时间单调不减
check('事件全部落在 [0, 12s) 内且时间有序', () => {
  for (let i = 0; i < seq1.length; i++) {
    assert.ok(seq1[i].t >= 0 && seq1[i].t < SIM.LOOP_SECONDS * 10000);
    if (i > 0) assert.ok(seq1[i].t >= seq1[i - 1].t);
  }
});

// 4. 参数敏感性：改动任一风源参数，音序应发生变化（证明参数确实影响触发）
check('改变强度/方向/衰减会改变音序（参数有效）', () => {
  const mods = [
    c => { c.sources[0].strength = 0.4; },
    c => { c.sources[2].angle += 0.5; },
    c => { c.sources[4].decay = 120; },
    c => { c.seed = 999; }
  ];
  for (const mod of mods) {
    const variant = JSON.parse(JSON.stringify(composition));
    mod(variant);
    assert.notDeepEqual(normalize(fullSequence(variant)), seq1);
  }
});

// 5. 掩盖规则确定性：同一事件流掩盖两次结果一致
check('声部掩盖规则本身是确定性的', () => {
  const raw = SIM.simulateLoop(composition, tubes);
  const m1 = normalize(SIM.applyMasking(raw, MASK_WINDOW, MAX_POLYPHONY));
  const m2 = normalize(SIM.applyMasking(raw, MASK_WINDOW, MAX_POLYPHONY));
  assert.deepEqual(m1, m2);
});

// 6. 高密度场景下掩盖确实生效（过密声部被丢弃）
check('高密度场景下过密声部被掩盖丢弃', () => {
  const dense = { seed: 7, sources: [] };
  for (let i = 0; i < 6; i++) {
    dense.sources.push({ x: 100 + i * 140, y: 480, angle: -Math.PI / 2, strength: 1.0, decay: 500 });
  }
  const raw = SIM.simulateLoop(dense, tubes);
  const masked = SIM.applyMasking(raw, MASK_WINDOW, MAX_POLYPHONY);
  assert.ok(masked.length < raw.length, `应丢弃部分事件（${raw.length} -> ${masked.length}）`);
  console.log(`    （高密度：${raw.length} 次原始触发 -> 掩盖后 ${masked.length} 次）`);
});

console.log(`\n音序摘要：${seq1.length} 次触发 / 12 秒`);
const perChime = new Array(SIM.CHIME_FREQS.length).fill(0);
for (const e of seq1) perChime[e.chime]++;
console.log('各管触发次数：' + perChime.map((n, i) => `${SIM.CHIME_NAMES[i]}:${n}`).join('  '));
console.log(`前 8 个事件：`);
for (const e of seq1.slice(0, 8)) {
  console.log(`  t=${(e.t / 10000).toFixed(3)}s  ${SIM.CHIME_NAMES[e.chime]}  力度=${(e.v / 1e6).toFixed(2)}`);
}
console.log(`\n全部 ${passed} 项测试通过 ✅`);
