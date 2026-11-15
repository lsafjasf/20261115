/* 应用主控：状态管理、localStorage 持久化、SVG 导入导出、混排验证报告。 */
(function () {
  'use strict';

  const STORAGE_KEY = 'counter-lab-state-v1';
  const DEFAULT_TEXT = '细字重 Stroke 0.5 不粘连，粗字重 2026 不吞掉字腔：ABCO 中文字体实验';

  // file:// 等协议可能禁用 localStorage，用内存对象兜底
  const memoryStore = {};
  const store = {
    get(key) {
      try { return localStorage.getItem(key); } catch (e) { return key in memoryStore ? memoryStore[key] : null; }
    },
    set(key, val) {
      try { localStorage.setItem(key, val); } catch (e) { memoryStore[key] = val; }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { delete memoryStore[key]; }
    },
  };

  const els = {
    text: document.getElementById('textInput'),
    weight: document.getElementById('weight'),
    roundness: document.getElementById('roundness'),
    tracking: document.getElementById('tracking'),
    lineHeight: document.getElementById('lineHeight'),
    adapt: document.getElementById('adapt'),
    weightVal: document.getElementById('weightVal'),
    roundVal: document.getElementById('roundVal'),
    trackVal: document.getElementById('trackVal'),
    lineVal: document.getElementById('lineVal'),
    canvas: document.getElementById('stage'),
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    importFile: document.getElementById('importFile'),
    testBtn: document.getElementById('testBtn'),
    resetBtn: document.getElementById('resetBtn'),
    report: document.getElementById('testReport'),
  };

  const rasterize = Raster.createCanvasRasterizer(180);
  const measurer = Measure.createMeasurer(rasterize);
  const engine = Engine.createEngine(measurer);

  function readState() {
    return {
      text: els.text.value,
      weight: parseFloat(els.weight.value),
      roundness: parseFloat(els.roundness.value),
      tracking: parseInt(els.tracking.value, 10),
      lineHeight: parseFloat(els.lineHeight.value),
      adapt: els.adapt.checked,
    };
  }

  function applyState(s) {
    if (!s) return;
    if (typeof s.text === 'string') els.text.value = s.text;
    for (const k of ['weight', 'roundness', 'tracking', 'lineHeight']) {
      if (s[k] != null && els[k]) els[k].value = s[k];
    }
    if (s.adapt != null) els.adapt.checked = !!s.adapt;
    syncLabels();
  }

  function syncLabels() {
    els.weightVal.textContent = parseFloat(els.weight.value).toFixed(2) + '×';
    els.roundVal.textContent = parseFloat(els.roundness.value).toFixed(2);
    els.trackVal.textContent = (els.tracking.value >= 0 ? '+' : '') + els.tracking.value;
    els.lineVal.textContent = parseFloat(els.lineHeight.value).toFixed(2);
  }

  let lastLayout = null;
  function rerender() {
    const state = readState();
    store.set(STORAGE_KEY, JSON.stringify(state));
    syncLabels();
    const rect = els.canvas.getBoundingClientRect();
    const maxWidth = Math.max(2000, (rect.width - 64) * (1000 / 64));
    lastLayout = engine.layout(state.text, Object.assign({}, state, { maxWidth }));
    Render.renderCanvas(els.canvas, lastLayout, state);
  }

  function exportCurrent() {
    const state = readState();
    const svg = Render.exportSVG(lastLayout, state);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'counter-lab-' + Date.now() + '.svg';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importSVG(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const state = Render.parseStateFromSVG(String(reader.result));
      if (!state) {
        alert('SVG 中未找到 counter-lab-state 元数据，无法恢复参数。');
        return;
      }
      applyState(state);
      rerender();
    };
    reader.readAsText(file);
  }

  // ---- 混排验证：细字重粘连检测 + 粗字重吞腔检测 ----
  function runVerification() {
    const sample = els.text.value || DEFAULT_TEXT;
    const chars = Array.from(new Set(Array.from(sample).filter((c) => c.trim() && GlyphLib[c] && !GlyphLib[c].space)));
    const rows = [];
    let allPass = true;
    for (const ch of chars) {
      const glyph = GlyphLib[ch];
      if (!glyph.strokes.length) continue;
      const thin = measurer.resolve(glyph, 0.5);
      const thick = measurer.resolve(glyph, 2.2);
      const thinOK = thin.metrics.bodyCount <= thin.base.bodyCount &&
        Math.min(...glyph.strokes.map((s) => s.w)) * thin.scale >= Measure.MIN_STROKE - 0.01;
      const thickOK = thick.metrics.counterCount >= thick.base.counterCount;
      let counterRatio = '—';
      if (thick.base.counters.length) {
        const baseSorted = thick.base.counters.map((c) => c.area).sort((a, b) => b - a);
        const nowSorted = thick.metrics.counters.map((c) => c.area).sort((a, b) => b - a);
        counterRatio = Math.min(...baseSorted.map((a, i) =>
          (nowSorted[i] || 0) / a)).toFixed(2);
      }
      if (!thinOK || !thickOK) allPass = false;
      rows.push({
        ch, thin: thin.scale.toFixed(2), thick: thick.scale.toFixed(2),
        clamped: thick.clamped, counters: thick.base.counterCount,
        ratio: counterRatio, thinOK, thickOK,
      });
    }
    const head = '<h3>验证结果（0.5× 细字重 / 2.2× 粗字重）' +
      (allPass ? '<span class="pass"> 全部通过</span>' : '<span class="fail"> 存在失败</span>') + '</h3>';
    const table = ['<table><tr><th>字</th><th>细×</th><th>粗×</th><th>限幅</th><th>字腔</th><th>腔面积比</th><th>细</th><th>粗</th></tr>']
      .concat(rows.map((r) => '<tr><td>' + r.ch + '</td><td>' + r.thin + '</td><td>' + r.thick +
        '</td><td>' + (r.clamped ? '是' : '否') + '</td><td>' + r.counters + '</td><td>' + r.ratio +
        '</td><td class="' + (r.thinOK ? 'pass' : 'fail') + '">' + (r.thinOK ? 'OK' : 'FAIL') +
        '</td><td class="' + (r.thickOK ? 'pass' : 'fail') + '">' + (r.thickOK ? 'OK' : 'FAIL') + '</td></tr>'))
      .concat(['</table>'])
      .join('');
    els.report.innerHTML = head + table;
    els.report.hidden = false;
    return allPass;
  }

  // ---- 事件绑定 ----
  for (const id of ['text', 'weight', 'roundness', 'tracking', 'lineHeight', 'adapt']) {
    const el = els[id];
    el.addEventListener('input', rerender);
    el.addEventListener('change', rerender);
  }
  els.exportBtn.addEventListener('click', exportCurrent);
  els.importBtn.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', () => {
    if (els.importFile.files[0]) importSVG(els.importFile.files[0]);
    els.importFile.value = '';
  });
  els.testBtn.addEventListener('click', runVerification);
  els.resetBtn.addEventListener('click', () => {
    store.remove(STORAGE_KEY);
    applyState({ text: DEFAULT_TEXT, weight: 1, roundness: 0.2, tracking: 40, lineHeight: 1.35, adapt: true });
    rerender();
  });
  window.addEventListener('resize', rerender);

  // ---- 启动：恢复上次参数 ----
  let saved = null;
  try { saved = JSON.parse(store.get(STORAGE_KEY) || 'null'); } catch (e) { saved = null; }
  applyState(saved || { text: DEFAULT_TEXT, weight: 1, roundness: 0.2, tracking: 40, lineHeight: 1.35, adapt: true });
  rerender();

  window.LabAPI = {
    measurer, engine, rasterize,
    readState, applyState, rerender, runVerification,
    exportSVG: () => Render.exportSVG(lastLayout, readState()),
    parseState: Render.parseStateFromSVG,
    setWeight: (w) => { els.weight.value = w; rerender(); },
    setRoundness: (r) => { els.roundness.value = r; rerender(); },
    setTracking: (t) => { els.tracking.value = t; rerender(); },
    setLineHeight: (h) => { els.lineHeight.value = h; rerender(); },
    glyphCount: () => Object.keys(GlyphLib).length,
  };
})();
