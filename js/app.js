/* 主逻辑：测试运行、标记交互、误差分析、补偿、档案与报告。 */
(function () {
  const $ = (id) => document.getElementById(id);
  const engine = window.audioEngine;

  const App = {
    compensationMs: 0,
    simLatencyMs: 0,
    pulses: [],        // 当前运行的脉冲 [{index, audioTime, flashPerfMs, errorMs}]
    running: false,
    sessionRuns: [],   // 本次会话已完成并有标记的运行记录
    storeState: null,
  };

  function log(msg) {
    const el = $('log');
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    el.textContent += `[${time}] ${msg}\n`;
    el.scrollTop = el.scrollHeight;
  }

  function setStatus(msg) { $('statusLine').textContent = msg; }

  /* ---------- 测试运行 ---------- */

  async function startRun() {
    await engine.resume();
    setStatus('音频运行中 — AudioContext: ' + engine.state());

    const count = parseInt($('selCount').value, 10);
    const intervalMs = parseInt($('selInterval').value, 10);
    const leadMs = 800;
    const startAudio = engine.now() + leadMs / 1000;

    App.pulses = [];
    for (let i = 0; i < count; i++) {
      const audioTime = startAudio + (i * intervalMs) / 1000;
      engine.scheduleClick(audioTime);
      App.pulses.push({
        index: i,
        audioTime,
        // 视觉闪烁时间 = 调度时间 + 补偿（补偿为正 → 闪烁延后，对齐被延迟的声音）
        flashPerfMs: engine.audioToPerfMs(audioTime) + App.compensationMs,
        errorMs: null,
      });
    }

    App.running = true;
    $('btnStart').disabled = true;
    $('btnAutoListen').disabled = true;
    $('btnClearMarks').disabled = true;
    $('runState').textContent = '播放中…';
    $('runState').classList.add('active');
    log(`开始测试：${count} 个脉冲，间隔 ${intervalMs} ms，当前补偿 ${App.compensationMs.toFixed(0)} ms`);

    const totalMs = leadMs + count * intervalMs + 300;
    setTimeout(finishRun, totalMs);
  }

  function finishRun() {
    App.running = false;
    $('btnStart').disabled = false;
    $('btnAutoListen').disabled = false;
    $('btnClearMarks').disabled = false;
    $('runState').textContent = '已完成，请标记';
    $('runState').classList.remove('active');
    log('播放完成，请移动标记估计每次听到声音的时间');
    refreshAnalysis();
  }

  /* ---------- 渲染循环 ---------- */

  function frame() {
    CanvasUI.drawFlash($('flashCanvas'), App.pulses, performance.now());
    CanvasUI.drawWave($('waveCanvas'), engine);
    requestAnimationFrame(frame);
  }

  /* ---------- 标记轨道交互 ---------- */

  function trackGeometry() {
    const canvas = $('trackCanvas');
    const w = canvas.clientWidth || canvas.width;
    const h = parseInt(canvas.getAttribute('height'), 10);
    const rowH = App.pulses.length ? h / App.pulses.length : h;
    const pxPerMs = (w / 2 - 70) / CanvasUI.TRACK_RANGE_MS;
    return { canvas, w, h, rowH, pxPerMs, cx: w / 2 };
  }

  let dragRow = -1;

  function rowFromEvent(e) {
    const g = trackGeometry();
    const rect = g.canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const row = Math.floor(y / g.rowH);
    return row >= 0 && row < App.pulses.length ? row : -1;
  }

  function setMarkerFromEvent(e) {
    const g = trackGeometry();
    const rect = g.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let err = (x - g.cx) / g.pxPerMs;
    err = Math.max(-CanvasUI.TRACK_RANGE_MS, Math.min(CanvasUI.TRACK_RANGE_MS, err));
    App.pulses[dragRow].errorMs = err;
    CanvasUI.drawTrack(g.canvas, App.pulses);
    refreshAnalysis();
  }

  function bindTrack() {
    const canvas = $('trackCanvas');
    canvas.addEventListener('mousedown', (e) => {
      if (!App.pulses.length) return;
      dragRow = rowFromEvent(e);
      if (dragRow >= 0) setMarkerFromEvent(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (dragRow >= 0) setMarkerFromEvent(e);
    });
    window.addEventListener('mouseup', () => { dragRow = -1; });
  }

  /* ---------- 误差分析 ---------- */

  function markedErrors() {
    return App.pulses.filter((p) => p.errorMs !== null).map((p) => p.errorMs);
  }

  function stats(values) {
    const n = values.length;
    if (!n) return null;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    return { n, mean, sd };
  }

  function refreshAnalysis() {
    const errors = markedErrors();
    const s = stats(errors);
    const meanMs = s ? s.mean : null;
    CanvasUI.drawErrors($('errorCanvas'), App.pulses, meanMs);

    if (!s) {
      $('estimateText').textContent = '尚无数据 — 请先播放脉冲并移动标记';
      $('btnApplyEstimate').disabled = true;
      return;
    }
    // 新补偿 = 当前补偿 + 平均误差（声音比闪烁晚 → 误差为正 → 补偿增大）
    const suggested = App.compensationMs + s.mean;
    $('estimateText').innerHTML =
      `已标记 <strong>${s.n}</strong> 个脉冲，平均误差 <strong>${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(1)} ms</strong>` +
      `（标准差 ${s.sd.toFixed(1)} ms）→ 建议补偿 <strong>${suggested.toFixed(1)} ms</strong>`;
    $('btnApplyEstimate').disabled = false;
    $('btnApplyEstimate').dataset.suggested = suggested.toFixed(1);
  }

  function recordRun() {
    const errors = markedErrors();
    const s = stats(errors);
    if (!s) return null;
    const rec = {
      at: new Date().toISOString(),
      compensationMs: App.compensationMs,
      count: App.pulses.length,
      marked: s.n,
      errors: errors.map((e) => Math.round(e * 10) / 10),
      meanMs: Math.round(s.mean * 10) / 10,
      sdMs: Math.round(s.sd * 10) / 10,
    };
    App.sessionRuns.push(rec);
    return rec;
  }

  /* ---------- 补偿 ---------- */

  function applyCompensation(ms, source) {
    App.compensationMs = Math.round(ms * 10) / 10;
    $('inpCompensation').value = App.compensationMs;
    App.storeState.lastCompensationMs = App.compensationMs;
    Store.save(App.storeState);
    log(`补偿已${source}：${App.compensationMs} ms（视觉闪烁相应延后）`);
  }

  function resetCompensation() {
    applyCompensation(0, '重置');
    App.pulses = [];
    App.sessionRuns = [];
    CanvasUI.drawTrack($('trackCanvas'), []);
    refreshAnalysis();
    $('runState').textContent = '空闲';
  }

  /* ---------- 模拟听辨（测试工具） ---------- */

  function autoListen() {
    if (!App.pulses.length) return;
    for (const p of App.pulses) {
      // 完美听辨者：感知误差 = 真实(模拟)延迟 - 当前补偿 + 小噪声
      const noise = (Math.random() * 2 - 1) * 3;
      p.errorMs = App.simLatencyMs - App.compensationMs + noise;
    }
    CanvasUI.drawTrack($('trackCanvas'), App.pulses);
    refreshAnalysis();
    log('模拟听辨完成：已按模拟延迟自动放置标记');
  }

  /* ---------- 档案 ---------- */

  function refreshProfileSelect() {
    const sel = $('selProfiles');
    sel.innerHTML = '';
    if (!App.storeState.profiles.length) {
      sel.innerHTML = '<option value="">（无档案）</option>';
      $('btnDeleteProfile').disabled = true;
      return;
    }
    for (const p of App.storeState.profiles) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name}（${p.compensationMs} ms）`;
      sel.appendChild(opt);
    }
    sel.value = App.storeState.activeId || App.storeState.profiles[0].id;
    $('btnDeleteProfile').disabled = false;
    updateProfileInfo();
  }

  function updateProfileInfo() {
    const p = Store.activeProfile(App.storeState);
    $('profileInfo').textContent = p
      ? `当前档案：${p.name}，补偿 ${p.compensationMs} ms，更新于 ${new Date(p.updatedAt).toLocaleString('zh-CN')}。刷新页面后自动恢复。`
      : '尚未保存档案。刷新页面后会恢复当前档案的补偿值。';
  }

  function saveProfile() {
    const name = $('inpProfileName').value.trim() || '未命名设备';
    recordRun();
    const rec = Store.saveProfile(App.storeState, name, App.compensationMs, App.sessionRuns);
    refreshProfileSelect();
    log(`档案已保存：${rec.name}（补偿 ${rec.compensationMs} ms）`);
  }

  function deleteProfile() {
    const id = $('selProfiles').value;
    if (!id) return;
    const p = App.storeState.profiles.find((x) => x.id === id);
    Store.deleteProfile(App.storeState, id);
    refreshProfileSelect();
    log(`档案已删除：${p ? p.name : id}`);
  }

  function selectProfile() {
    const id = $('selProfiles').value;
    const p = App.storeState.profiles.find((x) => x.id === id);
    if (!p) return;
    App.storeState.activeId = p.id;
    Store.save(App.storeState);
    applyCompensation(p.compensationMs, '从档案恢复');
    updateProfileInfo();
  }

  /* ---------- 报告导出 ---------- */

  function exportReport() {
    recordRun();
    const profile = Store.activeProfile(App.storeState);
    const report = {
      tool: 'audio-latency-calibrator',
      version: 1,
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      simulatedLatencyMs: App.simLatencyMs || null,
      currentCompensationMs: App.compensationMs,
      activeProfile: profile,
      profiles: App.storeState.profiles,
      sessionRuns: App.sessionRuns,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'calibration-report-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    log('校准报告已导出（JSON）');
  }

  /* ---------- 初始化 ---------- */

  function applySimLatency(ms) {
    App.simLatencyMs = Math.max(0, Math.min(1500, ms));
    engine.setSimLatency(App.simLatencyMs);
    $('inpSimLatency').value = App.simLatencyMs;
    $('simBadge').textContent = '模拟延迟: ' + App.simLatencyMs + ' ms';
    log('模拟输出延迟设为 ' + App.simLatencyMs + ' ms');
  }

  function init() {
    App.storeState = Store.load();

    // 刷新后恢复：优先激活档案，否则上次的补偿值
    const profile = Store.activeProfile(App.storeState);
    App.compensationMs = profile ? profile.compensationMs : App.storeState.lastCompensationMs;
    $('inpCompensation').value = App.compensationMs;
    if (profile) log(`已从档案「${profile.name}」恢复补偿 ${profile.compensationMs} ms`);

    // URL 参数可预设模拟延迟，便于自动化验证
    const urlSim = new URLSearchParams(location.search).get('simLatency');
    if (urlSim !== null) applySimLatency(Number(urlSim) || 0);

    refreshProfileSelect();

    $('btnStart').addEventListener('click', startRun);
    $('btnAutoListen').addEventListener('click', autoListen);
    $('btnClearMarks').addEventListener('click', () => {
      App.pulses.forEach((p) => { p.errorMs = null; });
      CanvasUI.drawTrack($('trackCanvas'), App.pulses);
      refreshAnalysis();
    });
    $('btnApplyEstimate').addEventListener('click', () => {
      recordRun();
      applyCompensation(parseFloat($('btnApplyEstimate').dataset.suggested), '应用估计值');
      refreshAnalysis();
    });
    $('btnApplyManual').addEventListener('click', () => {
      applyCompensation(parseFloat($('inpCompensation').value) || 0, '手动应用');
    });
    $('btnReset').addEventListener('click', resetCompensation);
    $('btnSaveProfile').addEventListener('click', saveProfile);
    $('btnDeleteProfile').addEventListener('click', deleteProfile);
    $('btnExport').addEventListener('click', exportReport);
    $('selProfiles').addEventListener('change', selectProfile);
    $('btnApplySim').addEventListener('click', () => {
      applySimLatency(parseFloat($('inpSimLatency').value) || 0);
    });

    bindTrack();
    CanvasUI.drawTrack($('trackCanvas'), []);
    refreshAnalysis();
    requestAnimationFrame(frame);
  }

  /* 测试钩子：供自动化验证读取状态 */
  window.__calib = {
    app: App,
    estimate() {
      const s = stats(markedErrors());
      return s ? { mean: s.mean, sd: s.sd, n: s.n, suggested: App.compensationMs + s.mean } : null;
    },
  };

  init();
})();
