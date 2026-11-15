/*
 * water-app.js
 * 面板绑定、渲染循环、FPS 统计、自适应质量、JSON 保存/载入与页内自检。
 */
(function () {
  'use strict';
  const C = window.WaterCore;

  const $ = (id) => document.getElementById(id);
  const els = {
    canvas: $('glCanvas'),
    glError: $('glError'),
    fpsBadge: $('fpsBadge'),
    qualityBadge: $('qualityBadge'),
    modeBadge: $('modeBadge'),
    rippleScale: $('rippleScale'),
    rippleScaleVal: $('rippleScaleVal'),
    direction: $('direction'),
    directionVal: $('directionVal'),
    waterColor: $('waterColor'),
    fogColor: $('fogColor'),
    fogDensity: $('fogDensity'),
    fogDensityVal: $('fogDensityVal'),
    reflection: $('reflection'),
    reflectionVal: $('reflectionVal'),
    quality: $('quality'),
    presetButtons: $('presetButtons'),
    btnSave: $('btnSave'),
    btnCopy: $('btnCopy'),
    btnLoad: $('btnLoad'),
    btnReset: $('btnReset'),
    btnTest: $('btnTest'),
    fileInput: $('fileInput'),
    testResults: $('testResults'),
    toast: $('toast'),
  };

  let renderer = null;
  let params = C.makeDefaults();
  let policy = null;
  let activeTier = 'high';
  let rafId = 0;
  let startTime = performance.now();
  let lastFrame = startTime;
  let fpsEMA = 60;
  let lastBadgeUpdate = 0;

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function syncControls() {
    els.rippleScale.value = params.rippleScale;
    els.direction.value = params.direction;
    els.waterColor.value = params.waterColor;
    els.fogColor.value = params.fogColor;
    els.fogDensity.value = params.fogDensity;
    els.reflection.value = params.reflection;
    els.quality.value = params.quality;
    updateValueLabels();
  }

  function updateValueLabels() {
    els.rippleScaleVal.textContent = Number(params.rippleScale).toFixed(2);
    els.directionVal.textContent = String(Math.round(params.direction)) + '°';
    els.fogDensityVal.textContent = Number(params.fogDensity).toFixed(3);
    els.reflectionVal.textContent = Number(params.reflection).toFixed(2);
  }

  function applyParamsToRenderer(timeSec) {
    renderer.applyParams(params, timeSec);
  }

  function effectiveTier() {
    return params.quality === 'auto' ? activeTier : params.quality;
  }

  function updateQualityBadge() {
    const tier = effectiveTier();
    const q = C.QUALITY_TIERS[tier];
    els.qualityBadge.textContent = '质量: ' + q.label + '（' + tier + '）';
    els.qualityBadge.className = 'badge tier-' + tier;
    els.modeBadge.textContent = '模式: ' + (params.quality === 'auto' ? '自动' : '手动');
  }

  function setTier(tier) {
    if (tier === activeTier) return;
    activeTier = tier;
    renderer.setQuality(tier);
    resizeCanvas();
    updateQualityBadge();
  }

  function resizeCanvas() {
    const rect = els.canvas.getBoundingClientRect();
    renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
  }

  function frame(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const instantFps = 1 / Math.max(dt, 1e-4);
    fpsEMA = fpsEMA * 0.9 + instantFps * 0.1;

    if (params.quality === 'auto') {
      const next = policy.sample(instantFps);
      if (next !== activeTier) setTier(next);
    }

    const timeSec = (now - startTime) / 1000;
    applyParamsToRenderer(timeSec);
    renderer.render(timeSec);

    if (now - lastBadgeUpdate > 250) {
      lastBadgeUpdate = now;
      els.fpsBadge.textContent = 'FPS: ' + Math.round(fpsEMA);
      els.fpsBadge.classList.toggle('lowfps', fpsEMA < 30);
    }
    rafId = requestAnimationFrame(frame);
  }

  function bindRange(input, key) {
    input.addEventListener('input', () => {
      params[key] = C.normalizeParams(Object.assign({}, params, { [key]: Number(input.value) }))[key];
      updateValueLabels();
      saveLocal();
    });
  }

  function bindControls() {
    bindRange(els.rippleScale, 'rippleScale');
    bindRange(els.direction, 'direction');
    bindRange(els.fogDensity, 'fogDensity');
    bindRange(els.reflection, 'reflection');
    els.waterColor.addEventListener('input', () => {
      params.waterColor = els.waterColor.value;
      saveLocal();
    });
    els.fogColor.addEventListener('input', () => {
      params.fogColor = els.fogColor.value;
      saveLocal();
    });
    els.quality.addEventListener('change', () => {
      params.quality = els.quality.value;
      if (params.quality !== 'auto') {
        setTier(params.quality);
      } else {
        policy.reset(activeTier);
        updateQualityBadge();
      }
      saveLocal();
    });
    window.addEventListener('resize', resizeCanvas);
  }

  function buildPresetButtons() {
    C.makePresets().forEach((preset, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '预设 ' + (index + 1) + ' · ' + preset.name;
      btn.addEventListener('click', () => {
        params = C.normalizeParams(preset.params);
        syncControls();
        updateQualityBadge();
        saveLocal();
        toast('已应用：' + preset.name);
      });
      els.presetButtons.appendChild(btn);
    });
  }

  function saveLocal() {
    try {
      localStorage.setItem(C.STORAGE_KEY, C.toJSON(params));
    } catch (_) { /* 隐私模式等场景下静默降级 */ }
  }

  function loadLocal() {
    try {
      const text = localStorage.getItem(C.STORAGE_KEY);
      if (text) params = C.fromJSON(text);
    } catch (err) {
      console.warn('本地配置载入失败，使用默认值', err);
    }
  }

  function downloadJSON() {
    const blob = new Blob([C.toJSON(params)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'water-config.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('JSON 已保存到下载目录');
  }

  async function copyJSON() {
    const text = C.toJSON(params);
    try {
      await navigator.clipboard.writeText(text);
      toast('JSON 已复制到剪贴板');
    } catch (_) {
      window.prompt('复制以下 JSON：', text);
    }
  }

  function importJSONText(text) {
    try {
      params = C.fromJSON(text);
      syncControls();
      if (params.quality !== 'auto') setTier(params.quality);
      updateQualityBadge();
      saveLocal();
      toast('JSON 载入成功');
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    }
  }

  function bindIO() {
    els.btnSave.addEventListener('click', downloadJSON);
    els.btnCopy.addEventListener('click', copyJSON);
    els.btnLoad.addEventListener('click', () => els.fileInput.click());
    els.btnReset.addEventListener('click', () => {
      params = C.makeDefaults();
      syncControls();
      updateQualityBadge();
      saveLocal();
      toast('已恢复默认参数');
    });
    els.fileInput.addEventListener('change', () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importJSONText(String(reader.result));
      reader.readAsText(file);
      els.fileInput.value = '';
    });
  }

  // ---- 页内自检（离屏 canvas，冻结时间，确定性渲染） ----

  function createTestRenderer() {
    const canvas = document.createElement('canvas');
    const r = window.WaterRenderer.createRenderer(canvas, C);
    r.resize(160, 96, 1); // 固定 1:1 像素，消除 DPR 与布局带来的不确定性
    return r;
  }

  function capture(rendererInstance, p, timeSec) {
    rendererInstance.applyParams(p, timeSec);
    rendererInstance.render(timeSec);
    return rendererInstance.readPixels();
  }

  function runSelfTest() {
    const lines = [];
    let failures = 0;
    function check(name, ok, detail) {
      lines.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
      if (!ok) failures += 1;
    }

    const presets = C.makePresets();
    const tiers = C.TIER_ORDER;
    const testTime = 3.21; // 任意但固定的时间点

    // 测试 1：三组参数 JSON 保存 -> 载入，对象完全一致
    presets.forEach((preset, i) => {
      const json = C.toJSON(preset.params);
      let reloaded = null;
      try {
        reloaded = C.fromJSON(json);
      } catch (err) {
        check('预设' + (i + 1) + ' JSON 往返', false, err.message);
        return;
      }
      const expected = C.normalizeParams(preset.params);
      check(
        '预设' + (i + 1) + ' JSON 往返一致',
        JSON.stringify(reloaded) === JSON.stringify(expected),
        preset.name
      );
    });

    let testRenderer = null;
    try {
      testRenderer = createTestRenderer();
    } catch (err) {
      check('离屏 WebGL 初始化', false, err.message);
      finishSelfTest(lines, failures);
      return;
    }
    const captureWith = (tier, p, timeSec) => {
      testRenderer.setQuality(tier);
      return capture(testRenderer, p, timeSec);
    };

    // 测试 2：同一参数在高/中/低三档渲染，整体色相差异 <= 2°
    // 且颜色 uniform 输入逐字节相同（质量设置不含颜色字段）。
    presets.forEach((preset, i) => {
      const p = C.normalizeParams(preset.params);
      const hues = {};
      tiers.forEach((tier) => { hues[tier] = C.frameHue(captureWith(tier, p, testTime)); });
      const spread = Math.max(
        C.hueDistance(hues.high, hues.medium),
        C.hueDistance(hues.high, hues.low),
        C.hueDistance(hues.medium, hues.low)
      );
      check(
        '预设' + (i + 1) + ' 跨质量档色相一致',
        spread <= 2,
        'hue 高=' + hues.high.toFixed(1) + '° 中=' + hues.medium.toFixed(1) +
          '° 低=' + hues.low.toFixed(1) + '° 最大偏差=' + spread.toFixed(2) + '°'
      );
    });

    // 测试 3：同档同参数同时间重复渲染必须逐字节一致（无随机性闪烁源）
    presets.forEach((preset, i) => {
      const p = C.normalizeParams(preset.params);
      const a = captureWith('low', p, testTime);
      const b = captureWith('low', p, testTime);
      const cmp = C.compareFrames(a, b);
      check('预设' + (i + 1) + ' 低档重复渲染确定性', cmp.maxAbsDiff === 0,
        '最大通道差=' + cmp.maxAbsDiff);
    });

    // 测试 4：时间推进的逐帧抖动，低档不应比高档更剧烈（无明显闪烁）
    presets.forEach((preset, i) => {
      const p = C.normalizeParams(preset.params);
      const deltas = {};
      tiers.forEach((tier) => {
        const f1 = captureWith(tier, p, 1.0);
        const f2 = captureWith(tier, p, 1.0 + 1 / 60);
        deltas[tier] = C.compareFrames(f1, f2).meanAbsDiff;
      });
      check(
        '预设' + (i + 1) + ' 低档帧抖动不高于高档',
        deltas.low <= deltas.high + 0.15,
        '每通道平均差 高=' + deltas.high.toFixed(3) + ' 中=' + deltas.medium.toFixed(3) +
          ' 低=' + deltas.low.toFixed(3)
      );
    });

    // 测试 5：高 <-> 低反复切换 5 次后画面仍与初始一致（切换不引入状态污染）
    presets.forEach((preset, i) => {
      const p = C.normalizeParams(preset.params);
      const baseline = captureWith('low', p, testTime);
      for (let k = 0; k < 5; k += 1) {
        testRenderer.setQuality('high');
        testRenderer.resize(160, 96, 1); // 模拟真实切换：DPR 上限变化触发缓冲重建
        testRenderer.setQuality('low');
        testRenderer.resize(160, 96, 1);
      }
      const after = captureWith('low', p, testTime);
      const cmp = C.compareFrames(baseline, after);
      check('预设' + (i + 1) + ' 质量反复切换无状态污染', cmp.maxAbsDiff === 0,
        '最大通道差=' + cmp.maxAbsDiff);
    });

    testRenderer.dispose();
    finishSelfTest(lines, failures);
  }

  function finishSelfTest(lines, failures) {
    lines.push('');
    lines.push(failures === 0 ? '结论：全部 ' + lines.filter((l) => l.startsWith('PASS')).length + ' 项通过'
      : '结论：' + failures + ' 项失败');
    els.testResults.style.display = 'block';
    els.testResults.innerHTML = lines
      .map((line) => {
        const cls = line.startsWith('PASS') ? 'pass' : line.startsWith('FAIL') ? 'fail' : '';
        return '<div class="' + cls + '">' + line + '</div>';
      })
      .join('');
    toast(failures === 0 ? '自检全部通过' : '自检存在失败项');
  }

  function init() {
    loadLocal();
    syncControls();
    try {
      renderer = window.WaterRenderer.createRenderer(els.canvas, C);
    } catch (err) {
      els.glError.style.display = 'flex';
      els.glError.textContent = err.message || 'WebGL 初始化失败';
      return;
    }
    policy = C.createQualityPolicy({
      now: () => performance.now(),
      initial: 'high',
    });
    renderer.setQuality(effectiveTier());
    resizeCanvas();
    updateQualityBadge();
    bindControls();
    bindIO();
    buildPresetButtons();
    els.btnTest.addEventListener('click', runSelfTest);

    // 标签页切回后避免用巨大 dt 污染 FPS 统计
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        lastFrame = performance.now();
        startTime = performance.now();
      }
    });

    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
