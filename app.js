// app.js — 演播台主逻辑:播放循环、预览网格、时间线交互、检查器、导出。
(function () {
  const project = Cameras.clone(Cameras.DEFAULT_PROJECT);
  const PROG_W = 960, PROG_H = 540;

  const programCanvas = document.getElementById('program');
  const programCtx = programCanvas.getContext('2d');
  const prevCanvases = {
    cam1: document.getElementById('prev-cam1'),
    cam2: document.getElementById('prev-cam2'),
    cam3: document.getElementById('prev-cam3'),
  };

  let worldT = 0;          // 世界时间:切镜永不重置
  let playing = false;
  let rafId = null;
  let lastFrameTs = null;
  let selectedShotId = project.shots[0].id;
  let audioCtx = null;
  let beatTrack = null;

  const $ = (id) => document.getElementById(id);

  function fmt(t) {
    const s = Math.floor(t);
    return '00:' + String(s).padStart(2, '0') + '.' + Math.floor((t - s) * 10);
  }

  // ---- 渲染 ----
  function renderAll() {
    const info = Cameras.renderProgram(programCtx, project, worldT, PROG_W, PROG_H);
    for (const cam of project.cameras) {
      const cv = prevCanvases[cam.id];
      Cameras.renderWithCamera(cv.getContext('2d'), project, cam.id, worldT, cv.width, cv.height);
    }
    document.querySelectorAll('.preview-grid figure').forEach((f) => f.classList.remove('active'));
    const activeFig = prevCanvases[info.shot.cameraId].closest('figure');
    activeFig.classList.add('active');
    $('liveShot').textContent =
      '当前镜头:' + info.shot.id + ' → ' + Cameras.getCamera(project, info.shot.cameraId).name +
      (info.active ? ' (转场中 ' + Math.round(info.progress * 100) + '%)' : '');
    $('timecode').textContent = fmt(worldT) + ' / ' + fmt(project.duration);
    updatePlayhead();
  }

  function tick(ts) {
    if (!playing) return;
    if (lastFrameTs == null) lastFrameTs = ts;
    const dt = Math.min(0.1, (ts - lastFrameTs) / 1000);
    lastFrameTs = ts;
    worldT += dt;
    if (worldT >= project.duration) { pause(); worldT = project.duration; }
    renderAll();
    if (playing) rafId = requestAnimationFrame(tick);
  }

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      beatTrack = BeatTrack.createBeatTrack(audioCtx, project);
      beatTrack.master.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function play() {
    if (playing || worldT >= project.duration) return;
    ensureAudio();
    beatTrack.schedule(audioCtx.currentTime + 0.05, worldT);
    playing = true;
    lastFrameTs = null;
    $('btnPlay').textContent = '⏸ 暂停';
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    $('btnPlay').textContent = '▶ 播放';
    if (rafId) cancelAnimationFrame(rafId);
    if (audioCtx && audioCtx.state === 'running' && !recording) audioCtx.suspend();
  }

  $('btnPlay').onclick = () => (playing ? pause() : play());
  $('btnStop').onclick = () => { pause(); worldT = 0; renderAll(); };

  // ---- 时间线 ----
  const CAM_COLORS = { cam1: '#2f6fed', cam2: '#22a06b', cam3: '#b465d8' };

  function buildTimeline() {
    const tl = $('timeline');
    tl.querySelectorAll('.shot-block').forEach((el) => el.remove());
    for (const s of project.shots) {
      const el = document.createElement('div');
      el.className = 'shot-block' + (s.id === selectedShotId ? ' selected' : '');
      el.dataset.shot = s.id;
      el.style.left = (s.start / project.duration) * 100 + '%';
      el.style.width = ((s.end - s.start) / project.duration) * 100 + '%';
      el.style.background = CAM_COLORS[s.cameraId] || '#555';
      el.textContent = s.id + ' · ' + s.cameraId + (s.transition.type !== 'cut' ? ' · ' + s.transition.type : '');
      el.onclick = (ev) => {
        selectedShotId = s.id;
        worldT = Math.min(s.start + 0.001, project.duration); // 跳转到镜头起点,世界时间连续
        buildTimeline();
        fillInspector();
        renderAll();
        ev.stopPropagation();
      };
      tl.appendChild(el);
    }
    let ph = document.getElementById('playhead');
    if (!ph) {
      ph = document.createElement('div');
      ph.id = 'playhead';
      tl.appendChild(ph);
    }
  }

  function updatePlayhead() {
    const ph = document.getElementById('playhead');
    if (ph) ph.style.left = (worldT / project.duration) * 100 + '%';
  }

  $('timeline').addEventListener('click', (ev) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    worldT = Math.min(((ev.clientX - rect.left) / rect.width) * project.duration, project.duration);
    renderAll();
  });

  // ---- 检查器 ----
  function fillInspector() {
    const s = project.shots.find((x) => x.id === selectedShotId);
    if (!s) return;
    $('inspShotName').textContent = s.id + '  [' + s.start + 's – ' + s.end + 's]';
    const sel = $('inspCamera');
    sel.innerHTML = '';
    for (const c of project.cameras) {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name;
      sel.appendChild(o);
    }
    sel.value = s.cameraId;
    $('inspTransition').value = s.transition.type;
    $('inspTransDur').value = s.transition.duration;
    const st = Cameras.cameraStateAt(Cameras.getCamera(project, s.cameraId), s.start);
    $('inspFocusX').value = Math.round(st.x);
    $('inspFocusY').value = Math.round(st.y);
    $('inspZoom').value = st.zoom.toFixed(2);
  }

  $('inspCamera').onchange = (e) => {
    const s = project.shots.find((x) => x.id === selectedShotId);
    s.cameraId = e.target.value;
    buildTimeline(); fillInspector(); renderAll();
  };
  $('inspTransition').onchange = (e) => {
    const s = project.shots.find((x) => x.id === selectedShotId);
    s.transition.type = e.target.value;
    if (s.transition.type === 'cut') s.transition.duration = 0;
    else if (s.transition.duration === 0) s.transition.duration = 0.5;
    buildTimeline(); fillInspector(); renderAll();
  };
  $('inspTransDur').onchange = (e) => {
    const s = project.shots.find((x) => x.id === selectedShotId);
    s.transition.duration = Math.max(0, Math.min(2, parseFloat(e.target.value) || 0));
    renderAll();
  };

  // 把焦点/缩放写入该镜头相机在镜头起止处的关键帧
  $('btnApplyCam').onclick = () => {
    const s = project.shots.find((x) => x.id === selectedShotId);
    const cam = Cameras.getCamera(project, s.cameraId);
    const fx = parseFloat($('inspFocusX').value);
    const fy = parseFloat($('inspFocusY').value);
    const zm = parseFloat($('inspZoom').value);
    if ([fx, fy, zm].some((v) => !isFinite(v))) return;
    cam.keys = cam.keys.filter((k) => k.t < s.start - 1e-6 || k.t > s.end + 1e-6);
    cam.keys.push({ t: s.start, x: fx, y: fy, zoom: zm });
    cam.keys.push({ t: s.end, x: fx, y: fy, zoom: zm });
    cam.keys.sort((a, b) => a.t - b.t);
    renderAll();
  };

  // ---- 导出 ----
  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  $('btnExportJson').onclick = () => {
    download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'project.json');
  };

  $('fileJson').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const data = JSON.parse(await f.text());
    Object.assign(project, data);
    selectedShotId = project.shots[0].id;
    worldT = 0;
    buildTimeline(); fillInspector(); renderAll();
  };

  // 从头实时播放 15 秒并录制:canvas 视频轨 + WebAudio 节拍轨
  let recording = false;
  async function exportWebM() {
    if (recording) return;
    recording = true;
    pause();
    worldT = 0;
    ensureAudio();
    $('exportStatus').textContent = '录制中… 0.0s / 15.0s';

    const dest = audioCtx.createMediaStreamDestination();
    beatTrack.master.connect(dest);
    const stream = programCanvas.captureStream(project.fps);
    const mixed = new MediaStream([
      ...stream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm';
    const rec = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });

    beatTrack.schedule(audioCtx.currentTime + 0.05, 0);
    rec.start(250);
    playing = true;
    lastFrameTs = null;
    $('btnPlay').textContent = '⏸ 暂停';
    rafId = requestAnimationFrame(tick);

    await new Promise((res) => {
      const iv = setInterval(() => {
        $('exportStatus').textContent = '录制中… ' + worldT.toFixed(1) + 's / ' + project.duration + 's';
        if (worldT >= project.duration) { clearInterval(iv); res(); }
      }, 100);
    });
    pause();
    rec.stop();
    await done;
    beatTrack.master.disconnect(dest);

    const blob = new Blob(chunks, { type: 'video/webm' });
    window.__lastExport = blob; // 供自动化验证脚本读取
    download(blob, 'program-15s.webm');
    $('exportStatus').textContent =
      '导出完成:program-15s.webm (' + (blob.size / 1024 / 1024).toFixed(2) + ' MB, ' + mime + ')';
    recording = false;
  }

  $('btnExportWebm').onclick = exportWebM;

  // 供自动化脚本调用:导出并以 base64 返回
  window.__exportAndGetBase64 = async function () {
    await exportWebM();
    const buf = await window.__lastExport.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return btoa(bin);
  };
  window.__project = project;

  // ---- 初始化 ----
  buildTimeline();
  fillInspector();
  renderAll();
})();
  document.querySelectorAll('.live-switch button').forEach((btn) => {
    btn.onclick = () => {
      const camId = btn.dataset.cam;
      const t = Math.min(worldT, project.duration - 0.1);
      const cur = Cameras.shotAt(project, t);
      if (cur.cameraId === camId) return;
      const idx = project.shots.indexOf(cur);
      const tail = { ...Cameras.clone(cur), id: 'shot' + Date.now(), start: t };
      cur.end = t;
      tail.transition = { type: 'crossfade', duration: 0.4 };
      tail.cameraId = camId;
      project.shots.splice(idx + 1, 0, tail);
      buildTimeline(); renderAll();
    };
  });
