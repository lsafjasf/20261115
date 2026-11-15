// 字幕轨道工作台前端：编辑校验、实时画面预览、播放同步、三种导出。
(function () {
  const { Project, ValidationError } = StudioCore;

  const DEFAULT_CUES = [
    [600, 2800, '清晨的光线慢慢爬上窗台。'],
    [3200, 5600, '风穿过树林，带来远处溪水的声音。'],
    [6000, 8600, '我们把脚步放轻，生怕惊动了鸟儿。'],
    [9000, 11600, '山路上的每一块石头，都记得行人的温度。'],
    [12000, 14800, '云在天上慢慢走，影子滑过整片田野。'],
    [15200, 18600, '当夜幕落下，星光会替我们记住今天。'],
  ];

  const el = {
    track: document.getElementById('track'),
    playhead: document.getElementById('playhead'),
    timeline: document.getElementById('timeline'),
    scrubber: document.getElementById('scrubber'),
    readout: document.getElementById('time-readout'),
    previewText: document.getElementById('preview-text'),
    rows: document.getElementById('cue-rows'),
    toast: document.getElementById('toast'),
  };

  const project = new Project(20000);
  for (const [start, end, text] of DEFAULT_CUES) project.addCue(start, end, text);

  let currentTimeMs = 0;
  let selectedId = null;
  let toastTimer = null;

  function showToast(message, kind = 'ok') {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.className = `toast ${kind}`;
    el.toast.hidden = false;
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3600);
  }

  function fmt(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const millis = ms % 1000;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  }

  // 所有会改数据的操作统一走这里：失败即回滚提示，保证非法状态绝不落库。
  function commit(label, mutate) {
    const snapshot = JSON.stringify(project.toJSON());
    try {
      const result = mutate();
      rebuildAudio();
      renderAll();
      showToast(`${label} 成功`);
      return result;
    } catch (error) {
      if (error instanceof ValidationError) {
        restoreSnapshot(snapshot);
        renderAll();
        showToast(`已阻止：${error.message}（${error.code}）`, 'error');
        return null;
      }
      throw error;
    }
  }

  function restoreSnapshot(snapshot) {
    const data = JSON.parse(snapshot);
    project.durationMs = data.durationMs;
    project.cues = data.cues.map((cue) => ({ ...cue }));
  }

  function renderTimeline() {
    el.track.innerHTML = '';
    for (const cue of project.sortedCues()) {
      const block = document.createElement('div');
      block.className = 'cue-block';
      if (cue.id === selectedId) block.classList.add('selected');
      if (currentTimeMs >= cue.start && currentTimeMs < cue.end) block.classList.add('active');
      block.style.left = `${(cue.start / project.durationMs) * 100}%`;
      block.style.width = `${((cue.end - cue.start) / project.durationMs) * 100}%`;
      block.textContent = cue.text;
      block.title = `#${cue.id} ${fmt(cue.start)} → ${fmt(cue.end)}`;
      block.addEventListener('click', (event) => {
        event.stopPropagation();
        selectedId = cue.id;
        seek(cue.start);
      });
      el.track.appendChild(block);
    }
    const ratio = Math.min(1, currentTimeMs / project.durationMs);
    el.playhead.style.left = `${ratio * 100}%`;
  }

  function renderRows() {
    el.rows.innerHTML = '';
    for (const cue of project.sortedCues()) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>#${cue.id}</td>
        <td><input data-field="start" type="number" min="0" max="${project.durationMs}" value="${cue.start}"></td>
        <td><input data-field="end" type="number" min="0" max="${project.durationMs}" value="${cue.end}"></td>
        <td><input data-field="text" type="text" value="${cue.text.replace(/"/g, '&quot;')}"></td>
        <td><div class="row-actions">
          <button class="secondary" data-action="split">断句</button>
          <button class="danger" data-action="remove">删除</button>
        </div></td>`;
      tr.querySelectorAll('input').forEach((input) => {
        input.addEventListener('change', () => {
          const field = input.dataset.field;
          const patch = {};
          if (field === 'text') patch.text = input.value;
          else patch[field] = Number(input.value);
          commit(`字幕 #${cue.id} 修改`, () => project.updateCue(cue.id, patch));
        });
      });
      tr.querySelector('[data-action="split"]').addEventListener('click', () => {
        const point = Math.round((cue.start + cue.end) / 2);
        commit(`字幕 #${cue.id} 断句`, () => project.splitCue(cue.id, point));
      });
      tr.querySelector('[data-action="remove"]').addEventListener('click', () => {
        commit(`字幕 #${cue.id} 删除`, () => project.removeCue(cue.id));
      });
      el.rows.appendChild(tr);
    }
  }

  function renderPreview() {
    const active = project.activeCueAt(currentTimeMs);
    el.previewText.textContent = active ? active.text : '';
    el.scrubber.max = project.durationMs;
    el.scrubber.value = currentTimeMs;
    el.readout.textContent = `${fmt(currentTimeMs)} / ${fmt(project.durationMs)}`;
  }

  function renderAll() {
    renderTimeline();
    renderRows();
    renderPreview();
  }

  function seek(timeMs) {
    currentTimeMs = Math.max(0, Math.min(project.durationMs, Math.round(timeMs)));
    syncPlayback();
    renderAll();
  }

  // ---- 播放引擎：音频与播放头共用同一个 AudioContext 时钟，seek 时一起跳转 ----
  let audioCtx = null;
  let audioBuffer = null;
  let sourceNode = null;
  let playing = false;
  let startCtxTime = 0;
  let startProjectTime = 0;
  let rafId = null;

  function rebuildAudio() {
    if (!audioCtx) return;
    const wasPlaying = playing;
    stopSource();
    audioBuffer = StudioCore.renderAudioBuffer(audioCtx, project.durationMs, project.sortedCues());
    if (wasPlaying) startSource(currentTimeMs);
  }

  function stopSource() {
    if (sourceNode) {
      try { sourceNode.onended = null; sourceNode.stop(); } catch (_) { /* 已停止 */ }
      sourceNode.disconnect();
      sourceNode = null;
    }
  }

  function startSource(offsetMs) {
    stopSource();
    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(audioCtx.destination);
    const offsetSec = offsetMs / 1000;
    sourceNode.start(0, offsetSec);
    startCtxTime = audioCtx.currentTime;
    startProjectTime = offsetMs;
    sourceNode.onended = () => {
      if (playing && currentTimeMs >= project.durationMs - 30) pause();
    };
  }

  function tick() {
    if (!playing) return;
    const elapsedMs = (audioCtx.currentTime - startCtxTime) * 1000;
    currentTimeMs = Math.min(project.durationMs, Math.round(startProjectTime + elapsedMs));
    if (currentTimeMs >= project.durationMs) {
      currentTimeMs = project.durationMs;
      pause();
    }
    renderAll();
    rafId = requestAnimationFrame(tick);
  }

  function play() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (!audioBuffer) {
      audioBuffer = StudioCore.renderAudioBuffer(audioCtx, project.durationMs, project.sortedCues());
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (currentTimeMs >= project.durationMs) currentTimeMs = 0;
    playing = true;
    startSource(currentTimeMs);
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(rafId);
    stopSource();
    renderAll();
  }

  function syncPlayback() {
    if (playing) startSource(currentTimeMs);
  }

  // ---- DOM 事件 ----
  document.getElementById('btn-play').addEventListener('click', () => {
    if (playing) pause(); else play();
  });
  el.scrubber.addEventListener('input', () => seek(Number(el.scrubber.value)));
  el.timeline.addEventListener('click', (event) => {
    const rect = el.timeline.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    seek(Math.round(ratio * project.durationMs));
  });

  document.getElementById('btn-add').addEventListener('click', () => {
    const start = Math.min(currentTimeMs, project.durationMs - 400);
    commit('新增字幕', () => project.addCue(start, start + 300, '新字幕文本'));
  });
  document.getElementById('btn-split').addEventListener('click', () => {
    const cue = project.activeCueAt(currentTimeMs);
    if (!cue) return showToast('播放头不在任何字幕内，无法断句', 'error');
    commit(`字幕 #${cue.id} 断句`, () => project.splitCue(cue.id, currentTimeMs));
  });

  document.getElementById('btn-vtt').addEventListener('click', () => {
    StudioCore.downloadText('subtitles.vtt', StudioCore.exportWebVtt(project), 'text/vtt');
    showToast('WebVTT 已导出');
  });
  document.getElementById('btn-wav').addEventListener('click', () => {
    const wav = StudioCore.synthesizeWav(project.durationMs, project.sortedCues());
    StudioCore.downloadBytes('rhythm.wav', wav, 'audio/wav');
    showToast('节奏提示音 WAV 已导出');
  });
  document.getElementById('btn-json').addEventListener('click', () => {
    StudioCore.downloadText('project.json', StudioCore.exportProjectJSON(project), 'application/json');
    showToast('工程 JSON 已导出');
  });
  document.getElementById('btn-reload').addEventListener('click', () => {
    document.getElementById('file-json').click();
  });
  document.getElementById('file-json').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    file.text().then((content) => {
      const reloaded = Project.fromJSON(JSON.parse(content));
      project.durationMs = reloaded.durationMs;
      project.cues = reloaded.cues;
      currentTimeMs = 0;
      rebuildAudio();
      renderAll();
      showToast(`工程已重载，共 ${reloaded.cues.length} 条字幕`);
    }).catch((error) => showToast(`重载失败：${error.message}`, 'error'));
    event.target.value = '';
  });

  window.StudioApp = {
    project, seek, commit, showToast,
    get currentTimeMs() { return currentTimeMs; },
  };
  renderAll();
})();
