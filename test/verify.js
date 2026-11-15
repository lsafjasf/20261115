/* Node 验证：模拟栅格器 + 同一套测量/排版引擎，验证混排、细字重粘连、粗字重吞腔。 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = globalThis;
for (const f of ['geometry.js', 'raster.js', 'measure.js', 'glyphs.js', 'hanzi.js', 'engine.js', 'render.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  new Function(code).call(root);
}

const rasterize = root.Raster.createMockRasterizer(128);
const measurer = root.Measure.createMeasurer(rasterize);
const engine = root.Engine.createEngine(measurer);

const SAMPLE = '细字重 Stroke 0.5 不粘连，粗字重 2026 不吞掉字腔：ABCO 中文字体实验';

test('字形库覆盖测试串中的全部字符（除空白）', () => {
  const missing = Array.from(new Set(Array.from(SAMPLE))).filter((c) =>
    c.trim() && !root.GlyphLib[c]);
  assert.deepEqual(missing, [], '未覆盖字符: ' + missing.join(' '));
  assert.ok(Object.keys(root.GlyphLib).length >= 90);
});

test('排版输出为每个字符生成测量后的布局项', () => {
  const layout = engine.layout(SAMPLE, {
    weight: 1, roundness: 0.2, tracking: 40, lineHeight: 1.35, adapt: true,
  });
  const nonSpace = layout.items.filter((it) => !it.space);
  assert.equal(nonSpace.length, Array.from(SAMPLE).filter((c) => c.trim()).length);
  assert.ok(layout.contentWidth > 0 && layout.contentHeight > 0);
  assert.ok(layout.items.every((it) => it.scale > 0));
});

test('伪字形回退可测量、可布局（不加载字体文件）', () => {
  const g = engine.pseudoGlyph('龴');
  const r = measurer.resolve(g, 1.4);
  assert.ok(r.scale > 0 && r.metrics);
  const layout = engine.layout('A龴9', { weight: 1, tracking: 0, adapt: true });
  assert.equal(layout.items.length, 3);
});

test('细字重 0.5×：不出现新增墨象块（笔画断开/粘连异常）', () => {
  const failures = [];
  for (const ch of new Set(Array.from(SAMPLE))) {
    if (!ch.trim()) continue;
    const glyph = root.GlyphLib[ch];
    if (!glyph || !glyph.strokes.length) continue;
    const r = measurer.resolve(glyph, 0.5);
    if (r.metrics.bodyCount > r.base.bodyCount) failures.push(ch);
    const minW = Math.min(...glyph.strokes.map((s) => s.w)) * r.scale;
    if (minW < root.Measure.MIN_STROKE - 0.01) failures.push(ch + ':minw');
  }
  assert.deepEqual(failures, []);
});

test('粗字重 2.2×：字腔数量不减少（不吞腔），面积不低于基准 35%', () => {
  const failures = [];
  const report = [];
  for (const ch of new Set(Array.from(SAMPLE))) {
    if (!ch.trim()) continue;
    const glyph = root.GlyphLib[ch];
    if (!glyph || !glyph.strokes.length || !measurer.baseMetrics(glyph).counters.length) continue;
    const r = measurer.resolve(glyph, 2.2);
    const baseSorted = r.base.counters.map((c) => c.area).sort((a, b) => b - a);
    const nowSorted = r.metrics.counters.map((c) => c.area).sort((a, b) => b - a);
    let ratio = 1;
    for (let i = 0; i < baseSorted.length; i++) ratio = Math.min(ratio, nowSorted[i] / baseSorted[i]);
    report.push(ch + ':' + r.scale.toFixed(2) + '/' + ratio.toFixed(2));
    if (r.metrics.counterCount < r.base.counterCount) failures.push(ch + ':count');
    if (ratio < root.Measure.MIN_COUNTER_RATIO - 0.001) failures.push(ch + ':area');
  }
  assert.ok(report.length >= 8, '带字腔的被测字过少: ' + report.join(','));
  assert.deepEqual(failures, []);
});

test('自适应开启 vs 关闭：带字腔字形在极端粗细下被限幅', () => {
  const glyph = root.GlyphLib['O'];
  const adapted = measurer.resolve(glyph, 2.4);
  assert.ok(adapted.scale <= 2.4);
  assert.ok(adapted.metrics.counterCount === adapted.base.counterCount);
});

test('SVG 导出包含可恢复的参数元数据并能解析还原', () => {
  const state = { text: SAMPLE, weight: 1.6, roundness: 0.4, tracking: 60, lineHeight: 1.5, adapt: true };
  const layout = engine.layout(SAMPLE, state);
  const svg = root.Render.exportSVG(layout, state);
  assert.ok(svg.includes('<svg') && svg.includes('counter-lab-state'));
  const restored = root.Render.parseStateFromSVG(svg);
  assert.deepEqual(restored, state);
  assert.ok(svg.includes('<path'));
});

test('字距与行高影响布局尺寸', () => {
  const base = engine.layout(SAMPLE, { weight: 1, tracking: 0, lineHeight: 1.2, adapt: true });
  const wide = engine.layout(SAMPLE, { weight: 1, tracking: 200, lineHeight: 1.2, adapt: true });
  const tall = engine.layout(SAMPLE, { weight: 1, tracking: 0, lineHeight: 2.0, adapt: true });
  assert.ok(wide.contentWidth > base.contentWidth);
  assert.ok(tall.contentHeight > base.contentHeight);
});
