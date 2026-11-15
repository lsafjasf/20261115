// cameras.js — 三台可移动相机、镜头(shot)时间线、转场合成。
// 相机状态由世界时间 t 经关键帧插值得到;切镜不改变 t,因此动画世界时间连续。
(function (global) {
  const DEFAULT_PROJECT = {
    version: 1,
    title: '三机位 15 秒节目',
    duration: 15,
    fps: 30,
    world: { width: 2400, height: 1350 },
    audio: { bpm: 120, beatsPerBar: 4 },
    cameras: [
      {
        id: 'cam1', name: '相机 1 · 全景',
        keys: [
          { t: 0, x: 1200, y: 675, zoom: 0.55 },
          { t: 8, x: 1200, y: 675, zoom: 0.55 },
          { t: 12, x: 1600, y: 500, zoom: 0.9 },
          { t: 15, x: 2100, y: 280, zoom: 1.6 },
        ],
      },
      {
        id: 'cam2', name: '相机 2 · 舞者特写',
        keys: [
          { t: 0, x: 900, y: 900, zoom: 1.3 },
          { t: 4, x: 900, y: 900, zoom: 1.3 },
          { t: 8.5, x: 1250, y: 880, zoom: 1.5 },
          { t: 15, x: 1250, y: 880, zoom: 1.5 },
        ],
      },
      {
        id: 'cam3', name: '相机 3 · 行星与月亮',
        keys: [
          { t: 0, x: 1750, y: 420, zoom: 1.1 },
          { t: 8.5, x: 1750, y: 420, zoom: 1.1 },
          { t: 12, x: 1950, y: 330, zoom: 1.4 },
          { t: 15, x: 1950, y: 330, zoom: 1.4 },
        ],
      },
    ],
    shots: [
      { id: 'shot1', start: 0, end: 4, cameraId: 'cam1', transition: { type: 'cut', duration: 0 } },
      { id: 'shot2', start: 4, end: 8.5, cameraId: 'cam2', transition: { type: 'crossfade', duration: 0.6 } },
      { id: 'shot3', start: 8.5, end: 12, cameraId: 'cam3', transition: { type: 'wipe', duration: 0.5 } },
      { id: 'shot4', start: 12, end: 15, cameraId: 'cam1', transition: { type: 'crossfade', duration: 0.5 } },
    ],
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function smooth(u) { return u * u * (3 - 2 * u); }

  // 相机在世界时间 t 的状态(位置 = 焦点中心, zoom = 缩放)
  function cameraStateAt(cam, t) {
    const keys = cam.keys.slice().sort((a, b) => a.t - b.t);
    if (t <= keys[0].t) return { x: keys[0].x, y: keys[0].y, zoom: keys[0].zoom };
    const last = keys[keys.length - 1];
    if (t >= last.t) return { x: last.x, y: last.y, zoom: last.zoom };
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (t >= a.t && t <= b.t) {
        const u = smooth((t - a.t) / (b.t - a.t));
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, zoom: a.zoom + (b.zoom - a.zoom) * u };
      }
    }
    return { x: last.x, y: last.y, zoom: last.zoom };
  }

  function getCamera(project, id) {
    return project.cameras.find((c) => c.id === id);
  }

  function shotAt(project, t) {
    for (const s of project.shots) {
      if (t >= s.start && t < s.end) return s;
    }
    return project.shots[project.shots.length - 1];
  }

  function shotIndex(project, shot) {
    return project.shots.indexOf(shot);
  }

  // 世界坐标 -> 屏幕坐标
  function worldToScreen(state, wx, wy, W, H) {
    return { x: (wx - state.x) * state.zoom + W / 2, y: (wy - state.y) * state.zoom + H / 2 };
  }

  // 用指定相机状态把世界画进 ctx(输出尺寸 W x H)
  function renderWithCamera(ctx, project, camId, t, W, H) {
    const cam = getCamera(project, camId);
    const st = cameraStateAt(cam, t);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.scale(st.zoom, st.zoom);
    ctx.translate(-st.x, -st.y);
    global.Scene.drawWorld(ctx, t);
    ctx.restore();
    return st;
  }

  // ---- 转场合成:在节目时间 t 渲染最终画面 ----
  // 转场期间:  outgoing = 上一镜头相机画面, incoming = 当前镜头相机画面。
  // progress=1 时画面严格等于 incoming 相机取景,保证转场结束与下一相机一致。
  const _off = {};
  function offscreen(key, W, H) {
    let c = _off[key];
    if (!c) { c = document.createElement('canvas'); _off[key] = c; }
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    return c;
  }

  function transitionInfo(project, t) {
    const shot = shotAt(project, t);
    const idx = shotIndex(project, shot);
    const tr = shot.transition || { type: 'cut', duration: 0 };
    const elapsed = t - shot.start;
    if (idx > 0 && tr.duration > 0 && elapsed < tr.duration) {
      return {
        active: true, shot, prevShot: project.shots[idx - 1],
        progress: elapsed / tr.duration, type: tr.type,
      };
    }
    return { active: false, shot, prevShot: idx > 0 ? project.shots[idx - 1] : null, progress: 1, type: tr.type };
  }

  function renderProgram(ctx, project, t, W, H) {
    const info = transitionInfo(project, t);
    if (!info.active) {
      renderWithCamera(ctx, project, info.shot.cameraId, t, W, H);
      return info;
    }
    const A = offscreen('transA', W, H).getContext('2d');
    const B = offscreen('transB', W, H).getContext('2d');
    renderWithCamera(A, project, info.prevShot.cameraId, t, W, H);
    renderWithCamera(B, project, info.shot.cameraId, t, W, H);
    const p = smooth(Math.min(1, Math.max(0, info.progress)));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (info.type === 'crossfade') {
      ctx.globalAlpha = 1;
      ctx.drawImage(A.canvas, 0, 0);
      ctx.globalAlpha = p;
      ctx.drawImage(B.canvas, 0, 0);
      ctx.globalAlpha = 1;
    } else if (info.type === 'wipe') {
      ctx.drawImage(A.canvas, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W * p, H);
      ctx.clip();
      ctx.drawImage(B.canvas, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(B.canvas, 0, 0);
    }
    ctx.restore();
    return info;
  }

  global.Cameras = {
    DEFAULT_PROJECT, clone, cameraStateAt, getCamera, shotAt, shotIndex,
    worldToScreen, renderWithCamera, renderProgram, transitionInfo,
  };
})(typeof window !== 'undefined' ? window : globalThis);
