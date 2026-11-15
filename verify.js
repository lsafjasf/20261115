// verify.js — 在浏览器中连续重新播放导出的 WebM,按帧采样并验证:
//  1) 三台相机的切换顺序  2) 各镜头中标记元素的位置
//  3) 转场结束帧与下一相机取景逐像素一致  4) 音频节拍存在且对齐全
// 注:MediaRecorder 生成的 WebM 缺少 seek 索引,因此采用实时播放采样而非 seek。
(async function () {
  const POS_TOL = 14;
  const report = { checks: [], pass: true };

  function check(name, ok, detail) {
    report.checks.push({ name, ok, detail });
    if (!ok) report.pass = false;
  }

  const project = await (await fetch('artifacts/project.json')).json();
  const video = document.getElementById('vid');
  video.src = 'artifacts/program-15s.webm';
  await new Promise((res, rej) => {
    video.onloadedmetadata = res;
    video.onerror = () => rej(new Error('视频加载失败'));
  });
  const W = video.videoWidth, H = video.videoHeight;
  check('视频元数据', W === 960 && H === 540, { W, H, duration: String(video.duration) });

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // ---- 连续播放,在目标时刻采样帧 ----
  const SAMPLE_TIMES = [0.5, 1.0, 2.0, 3.0, 4.65, 6.0, 9.05, 10.0, 12.55, 13.5];
  const frames = {}; // target -> {img, t}
  await (async function capture() {
    let idx = 0;
    await video.play();
    await new Promise((resolve) => {
      function onFrame() {
        while (idx < SAMPLE_TIMES.length && video.currentTime >= SAMPLE_TIMES[idx] - 0.001) {
          ctx.drawImage(video, 0, 0, W, H);
          frames[SAMPLE_TIMES[idx]] = { img: ctx.getImageData(0, 0, W, H), t: video.currentTime };
          idx++;
        }
        if (idx >= SAMPLE_TIMES.length) { video.pause(); resolve(); return; }
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(onFrame);
        else setTimeout(onFrame, 16);
      }
      onFrame();
      setTimeout(resolve, 40000); // 兜底
    });
  })();
  check('播放采样完整', Object.keys(frames).length === SAMPLE_TIMES.length,
    { captured: Object.keys(frames).length, wanted: SAMPLE_TIMES.length });

  function centroid(img, test) {
    const d = img.data;
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < img.height; y += 2) {
      for (let x = 0; x < img.width; x += 2) {
        const i = (y * img.width + x) * 4;
        if (test(d[i], d[i + 1], d[i + 2])) { sx += x; sy += y; n++; }
      }
    }
    return n > 30 ? { x: sx / n, y: sy / n, n } : null;
  }

  function expectedScreen(camId, tWorld, markerKey) {
    const cam = Cameras.getCamera(project, camId);
    const st = Cameras.cameraStateAt(cam, tWorld);
    const p = Scene.MARKERS[markerKey].pos(tWorld);
    return Cameras.worldToScreen(st, p.x, p.y, W, H);
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // ---- 估计视频时间与世界时间的固定偏移(相机1静止段的红色球) ----
  let best = { delta: 0, err: Infinity };
  for (let delta = -0.6; delta <= 0.6; delta += 0.02) {
    let err = 0, cnt = 0;
    for (const ts of [1.0, 2.0, 3.0]) {
      const f = frames[ts];
      if (!f) continue;
      const m = centroid(f.img, Scene.MARKERS.red.test);
      if (!m) continue;
      err += dist(m, expectedScreen('cam1', f.t + delta, 'red'));
      cnt++;
    }
    if (cnt && err / cnt < best.err) best = { delta, err: err / cnt };
  }
  check('时间偏移估计', best.err < POS_TOL, { delta: +best.delta.toFixed(3), avgErr: +best.err.toFixed(2) });
  const toWorld = (tv) => tv + best.delta;

  // ---- 1) 相机切换顺序:每个镜头中段采样,匹配误差最小的相机 ----
  const midSamples = [
    { t: 2.0, expect: 'cam1' },
    { t: 6.0, expect: 'cam2' },
    { t: 10.0, expect: 'cam3' },
    { t: 13.5, expect: 'cam1' },
  ];
  const detectedOrder = [];
  for (const s of midSamples) {
    const f = frames[s.t];
    const tw = toWorld(f.t);
    const measured = {};
    for (const k of Object.keys(Scene.MARKERS)) measured[k] = centroid(f.img, Scene.MARKERS[k].test);
    let bestCam = null, bestErr = Infinity;
    const perCam = {};
    for (const cam of project.cameras) {
      let err = 0, cnt = 0;
      for (const k of Object.keys(Scene.MARKERS)) {
        const exp = expectedScreen(cam.id, tw, k);
        if (exp.x < -40 || exp.x > W + 40 || exp.y < -40 || exp.y > H + 40) continue;
        if (!measured[k]) continue;
        err += dist(measured[k], exp);
        cnt++;
      }
      if (cnt > 0) {
        perCam[cam.id] = +(err / cnt).toFixed(2);
        if (err / cnt < bestErr) { bestErr = err / cnt; bestCam = cam.id; }
      }
    }
    detectedOrder.push(bestCam);
    check('镜头@' + s.t + 's 激活相机=' + s.expect, bestCam === s.expect && bestErr < POS_TOL,
      { detected: bestCam, avgErr: +bestErr.toFixed(2), perCam });
  }
  check('切换顺序 cam1→cam2→cam3→cam1',
    JSON.stringify(detectedOrder) === JSON.stringify(['cam1', 'cam2', 'cam3', 'cam1']),
    { detectedOrder });

  // ---- 2) 各镜头中标记元素的位置 ----
  for (const s of midSamples) {
    const f = frames[s.t];
    const tw = toWorld(f.t);
    for (const k of Object.keys(Scene.MARKERS)) {
      const exp = expectedScreen(s.expect, tw, k);
      if (exp.x < 0 || exp.x > W || exp.y < 0 || exp.y > H) continue;
      const m = centroid(f.img, Scene.MARKERS[k].test);
      const err = m ? dist(m, exp) : null;
      check('元素位置 ' + k + ' @' + s.t + 's (' + s.expect + ')',
        m !== null && err < POS_TOL,
        { expected: { x: +exp.x.toFixed(1), y: +exp.y.toFixed(1) },
          measured: m ? { x: +m.x.toFixed(1), y: +m.y.toFixed(1) } : null,
          err: err === null ? 'not-found' : +err.toFixed(2) });
    }
  }

  // ---- 3) 转场结束帧与下一相机取景逐像素一致 ----
  const expCanvas = document.createElement('canvas');
  expCanvas.width = W; expCanvas.height = H;
  const expCtx = expCanvas.getContext('2d', { willReadFrequently: true });
  for (const shot of project.shots) {
    const tr = shot.transition;
    if (!tr || tr.duration === 0 || shot.start === 0) continue;
    const tEnd = +(shot.start + tr.duration + 0.05).toFixed(2);
    const f = frames[tEnd];
    if (!f) { check('转场结束一致 ' + shot.id, false, { error: 'no frame at ' + tEnd }); continue; }
    const tw = toWorld(f.t);
    Cameras.renderWithCamera(expCtx, project, shot.cameraId, tw, W, H);
    const exp = expCtx.getImageData(0, 0, W, H).data;
    const got = f.img.data;
    let sum = 0, big = 0, n = 0;
    for (let i = 0; i < got.length; i += 16) {
      const d = Math.abs(got[i] - exp[i]) + Math.abs(got[i + 1] - exp[i + 1]) + Math.abs(got[i + 2] - exp[i + 2]);
      sum += d;
      if (d > 144) big++;
      n++;
    }
    const meanDiff = sum / n / 3;
    const bigRatio = big / n;
    check('转场结束一致 ' + shot.id + ' (' + tr.type + ' → ' + shot.cameraId + ')',
      meanDiff < 8 && bigRatio < 0.02,
      { tEnd, meanDiff: +meanDiff.toFixed(2), bigPixelRatio: +bigRatio.toFixed(4) });
  }

  // ---- 4) 音频节拍:解码 WebM 音轨,检测节拍起始点 ----
  const ab = await (await fetch('artifacts/program-15s.webm')).arrayBuffer();
  const ac = new OfflineAudioContext(1, 1, 44100);
  const audioBuf = await ac.decodeAudioData(ab);
  check('音轨存在', audioBuf.duration > 14, { duration: +audioBuf.duration.toFixed(2) });

  const data = audioBuf.getChannelData(0);
  const sr = audioBuf.sampleRate;
  const win = Math.floor(sr * 0.02);
  const energy = [];
  for (let i = 0; i + win < data.length; i += win) {
    let e = 0;
    for (let j = 0; j < win; j += 4) e += data[i + j] * data[i + j];
    energy.push(e);
  }
  const onsets = [];
  for (let i = 2; i < energy.length; i++) {
    const prev = (energy[i - 1] + energy[i - 2]) / 2;
    if (energy[i] > prev * 2.5 && energy[i] > 0.002 &&
        (onsets.length === 0 || i - onsets[onsets.length - 1] > 8)) {
      onsets.push(i);
    }
  }
  const onsetTimes = onsets.map((i) => (i * win) / sr);

  const spb = 60 / project.audio.bpm;
  const totalBeats = Math.floor(project.duration / spb) + 1;
  let matched = 0;
  for (let n = 0; n < totalBeats; n++) {
    if (onsetTimes.some((ot) => Math.abs(ot - n * spb) < 0.12)) matched++;
  }
  check('音频节拍对齐全(' + matched + '/' + totalBeats + ')',
    matched >= totalBeats - 3,
    { matched, totalBeats, onsetCount: onsetTimes.length });

  const shotAccents = project.shots.filter((s) => s.start > 0)
    .map((s) => onsetTimes.some((ot) => Math.abs(ot - s.start) < 0.15));
  check('切镜重音存在', shotAccents.every(Boolean),
    { shotStarts: project.shots.map((s) => s.start), shotAccents });

  // ---- 输出报告 ----
  window.__report = report;
  document.getElementById('report').textContent = JSON.stringify(report, null, 2);
  const failed = report.checks.filter((c) => !c.ok).length;
  const sum = document.getElementById('summary');
  sum.innerHTML = '<h2 class="' + (report.pass ? 'pass' : 'fail') + '">' +
    (report.pass ? '全部通过' : '失败 ' + failed + ' 项') +
    ' (' + (report.checks.length - failed) + '/' + report.checks.length + ')</h2>';
  document.title = report.pass ? 'VERIFY:PASS' : 'VERIFY:FAIL';
})().catch((e) => {
  window.__report = { pass: false, error: String(e && e.stack || e) };
  document.title = 'VERIFY:ERROR';
  document.getElementById('report').textContent = String(e && e.stack || e);
});
