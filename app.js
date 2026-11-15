// 主应用：Canvas 画面 + 字幕渲染、拖拽避让、Web Audio 节拍、导出
(function () {
  const { SAFE, obstacles, subtitles, PREFERRED, DURATION } = DEMO;
  const E = AvoidEngine;
  const W = 960, H = 540;
  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");

  const state = {
    t: 0,
    playing: false,
    beatOn: false,
    drag: null, // { sub, dx, dy }
    layoutDirty: true,
  };

  // ---- 文本测量 ----
  function measure(text, fontSize) {
    ctx.font = `${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    const w = ctx.measureText(text).width;
    return { w: w + 24, h: fontSize + 16 }; // 含内边距
  }

  // ---- 障碍物并集（字幕整个显示窗口内采样合并，保证位置稳定）----
  function blockersForWindow(t0, t1, extraRects) {
    const merged = [];
    for (let t = t0; t <= t1 + 1e-6; t += 0.25) {
      for (const ob of E.activeObstacles(obstacles, t, W, H)) merged.push(ob);
    }
    if (extraRects) for (const r of extraRects) merged.push({ rect: r, type: "sub" });
    return merged;
  }

  // ---- 自动布局：按优先级从高到低依次放置（共享引擎）----
  function layout() {
    E.layoutSubtitles(subtitles, obstacles, {
      measure,
      safe: E.normToPx(SAFE, W, H),
      W, H,
      preferred: PREFERRED,
      onStuck: showFallback,
    });
    state.layoutDirty = false;
    renderTable();
  }

  // ---- 画面背景（合成视频画面）----
  function drawScene(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#24344d");
    g.addColorStop(1, "#10151d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i < 5; i++) {
      const x = ((t * 40 + i * 220) % (W + 120)) - 60;
      ctx.beginPath();
      ctx.arc(x, 120 + i * 80, 34, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "14px monospace";
    ctx.fillText(`▶ DEMO VIDEO  ${t.toFixed(1)}s`, 16, H - 14);
  }

  const OB_STYLE = {
    face: { fill: "rgba(255,90,90,0.28)", stroke: "#ff5a5a" },
    product: { fill: "rgba(255,180,60,0.28)", stroke: "#ffb43c" },
    logo: { fill: "rgba(120,160,255,0.3)", stroke: "#78a0ff" },
  };

  function drawObstacles(t) {
    for (const ob of E.activeObstacles(obstacles, t, W, H)) {
      const s = OB_STYLE[ob.type] || OB_STYLE.logo;
      ctx.fillStyle = s.fill;
      ctx.strokeStyle = s.stroke;
      ctx.setLineDash([]);
      ctx.fillRect(ob.rect.x, ob.rect.y, ob.rect.w, ob.rect.h);
      ctx.strokeRect(ob.rect.x, ob.rect.y, ob.rect.w, ob.rect.h);
      ctx.fillStyle = s.stroke;
      ctx.font = "12px sans-serif";
      ctx.fillText(ob.label, ob.rect.x + 4, ob.rect.y + 14);
    }
  }

  function drawSafeArea() {
    const s = E.normToPx(SAFE, W, H);
    ctx.strokeStyle = "rgba(140,160,180,0.5)";
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(s.x, s.y, s.w, s.h);
    ctx.setLineDash([]);
  }

  // ---- 字幕绘制 ----
  function activeSubs(t) {
    return subtitles.filter((s) => t >= s.start && t <= s.end);
  }

  function drawSubtitle(sub, ghost) {
    const r = sub._rect;
    if (!r) return;
    ctx.font = `${sub.fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (!ghost) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    // 碰撞框：碰撞红色 / 避让后绿色 / 常规灰
    const stroke = sub._collides ? "#ff4d4d" : sub._avoided ? "#43d17c" : "rgba(255,255,255,0.35)";
    ctx.strokeStyle = stroke;
    ctx.lineWidth = sub._collides ? 2.5 : 1.5;
    ctx.setLineDash(ghost ? [4, 4] : []);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    if (!ghost) {
      ctx.fillStyle = "#fff";
      ctx.fillText(sub.text, r.x + r.w / 2, r.y + r.h / 2 + 1);
      if (sub._avoided) {
        ctx.fillStyle = "#43d17c";
        ctx.font = "11px sans-serif";
        ctx.fillText("已自动避让", r.x + r.w / 2, r.y - 8);
      }
    }
  }

  // 拖动时显示可行位置（绿色虚线框）
  function drawGhostCandidates(sub) {
    const safe = E.normToPx(SAFE, W, H);
    const others = subtitles.filter((s) => s !== sub && tActive(s, state.t)).map((s) => s._rect);
    const blockers = blockersForWindow(sub.start, sub.end, others);
    for (const a of E.candidateAnchors(safe, W, H)) {
      const rect = E.rectFromAnchor(a, sub._size);
      if (!E.insideSafe(rect, safe)) continue;
      const hit = blockers.some((b) => E.rectsOverlap(rect, b.rect));
      if (hit) continue;
      ctx.strokeStyle = "rgba(67,209,124,0.55)";
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.setLineDash([]);
    }
  }

  function tActive(sub, t) { return t >= sub.start && t <= sub.end; }

  // ---- 渲染循环 ----
  function render() {
    if (state.layoutDirty) layout();
    drawScene(state.t);
    drawSafeArea();
    drawObstacles(state.t);
    for (const sub of activeSubs(state.t)) {
      if (state.drag && state.drag.sub === sub) continue;
      drawSubtitle(sub);
    }
    if (state.drag) {
      drawGhostCandidates(state.drag.sub);
      drawSubtitle(state.drag.sub);
    }
  }

  let lastTs = null;
  function tick(ts) {
    if (state.playing) {
      if (lastTs != null) {
        state.t = Math.min(DURATION, state.t + (ts - lastTs) / 1000);
        if (state.t >= DURATION) state.playing = false;
        syncTransport();
      }
      maybeBeat();
    }
    lastTs = ts;
    render();
    requestAnimationFrame(tick);
  }

  // ---- 播放控制 ----
  const seek = document.getElementById("seek");
  const timeLabel = document.getElementById("timeLabel");
  const btnPlay = document.getElementById("btnPlay");
  function syncTransport() {
    seek.value = state.t;
    timeLabel.textContent = state.t.toFixed(1) + "s";
    btnPlay.textContent = state.playing ? "⏸ 暂停" : "▶ 播放";
  }
  btnPlay.addEventListener("click", () => {
    state.playing = !state.playing;
    if (state.playing && state.t >= DURATION) state.t = 0;
    syncTransport();
  });
  seek.addEventListener("input", () => {
    state.t = parseFloat(seek.value);
    syncTransport();
  });

  // ---- Web Audio 节拍（仅节拍，不处理音频内容）----
  let audioCtx = null;
  let nextBeat = 0;
  const btnBeat = document.getElementById("btnBeat");
  btnBeat.addEventListener("click", () => {
    state.beatOn = !state.beatOn;
    if (state.beatOn && !audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    btnBeat.textContent = state.beatOn ? "🔔 节拍" : "🔇 节拍";
  });
  function maybeBeat() {
    if (!state.beatOn || !audioCtx) return;
    if (state.t >= nextBeat) {
      nextBeat = Math.floor(state.t / 0.5) * 0.5 + 0.5; // 120 BPM
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = Math.round(state.t / 0.5) % 4 === 0 ? 1320 : 880;
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.09);
    }
  }

  // ---- 拖拽：实时碰撞框 + 可行位置吸附 ----
  function canvasPos(ev) {
    const b = canvas.getBoundingClientRect();
    return { x: ((ev.clientX - b.left) / b.width) * W, y: ((ev.clientY - b.top) / b.height) * H };
  }

  canvas.addEventListener("pointerdown", (ev) => {
    const p = canvasPos(ev);
    const subs = activeSubs(state.t).slice().reverse();
    for (const sub of subs) {
      const r = sub._rect;
      if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        state.drag = { sub, dx: p.x - (r.x + r.w / 2), dy: p.y - (r.y + r.h / 2) };
        canvas.setPointerCapture(ev.pointerId);
        break;
      }
    }
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (!state.drag) return;
    const p = canvasPos(ev);
    const sub = state.drag.sub;
    sub.manual = true;
    sub.pos = { x: (p.x - state.drag.dx) / W, y: (p.y - state.drag.dy) / H };
    sub._rect = E.rectFromAnchor({ x: sub.pos.x * W, y: sub.pos.y * H }, sub._size);
    const others = subtitles.filter((s) => s !== sub && tActive(s, state.t)).map((s) => s._rect);
    const blockers = blockersForWindow(sub.start, sub.end, others);
    sub._collides = blockers.some((b) => E.rectsOverlap(sub._rect, b.rect));
  });

  canvas.addEventListener("pointerup", () => {
    if (!state.drag) return;
    const sub = state.drag.sub;
    state.drag = null;
    if (sub._collides) {
      // 吸附到最近可行位置；找不到则提示延长显示或缩小字号
      const others = subtitles.filter((s) => s !== sub && tActive(s, state.t)).map((s) => s._rect);
      const blockers = blockersForWindow(sub.start, sub.end, others);
      const p = E.findPlacement({
        size: sub._size, blockers, safe: E.normToPx(SAFE, W, H), W, H,
        preferred: { x: sub.pos.x, y: sub.pos.y },
      });
      if (p) {
        sub.pos = { x: p.x / W, y: p.y / H };
        sub._rect = p.rect;
        sub._collides = false;
        sub._avoided = true;
      } else {
        showFallback(sub);
      }
    }
    state.layoutDirty = true;
  });

  // ---- 无解提示：延长显示 / 缩小字号 ----
  const alertBox = document.getElementById("alertBox");
  function showFallback(sub) {
    const others = subtitles.filter((s) => s !== sub).map((s) => s._rect).filter(Boolean);
    const suggestions = E.fallbackSuggestions({
      text: sub.text, fontSize: sub.fontSize, start: sub.start, end: sub.end,
      measure, blockers: blockersForWindow(sub.start, sub.end, others),
      safe: E.normToPx(SAFE, W, H), W, H, preferred: PREFERRED,
      makeBlockers: (t0, t1) => blockersForWindow(t0, t1, others),
    });
    alertBox.classList.remove("hidden");
    alertBox.innerHTML = `<strong>字幕 #${sub.id}</strong> 在当前时段找不到不遮挡的位置。` +
      (suggestions.length ? "可尝试：" : "（即使调整也无解，请改时间段）");
    for (const s of suggestions) {
      const btn = document.createElement("button");
      btn.textContent = s.kind === "shrink"
        ? `缩小字号到 ${s.fontSize}px`
        : `延长显示到 ${s.end.toFixed(1)}s（${s.start.toFixed(1)}s 起）`;
      btn.addEventListener("click", () => {
        if (s.kind === "shrink") sub.fontSize = s.fontSize;
        else { sub.start = s.start; sub.end = s.end; }
        sub.manual = false;
        alertBox.classList.add("hidden");
        state.layoutDirty = true;
      });
      alertBox.appendChild(btn);
    }
  }

  // ---- 字幕表格 ----
  function renderTable() {
    const tbody = document.querySelector("#subTable tbody");
    tbody.innerHTML = "";
    for (const sub of subtitles) {
      const tr = document.createElement("tr");
      if (tActive(sub, state.t)) tr.className = "active";
      tr.innerHTML = `<td>${sub.id}</td><td>${sub.text}</td>` +
        `<td>${sub.start.toFixed(1)}–${sub.end.toFixed(1)}s</td>`;
      const tdPri = document.createElement("td");
      const pri = document.createElement("input");
      pri.type = "number"; pri.min = 1; pri.max = 9; pri.value = sub.priority;
      pri.addEventListener("change", () => {
        sub.priority = parseInt(pri.value, 10) || 1;
        state.layoutDirty = true;
      });
      tdPri.appendChild(pri);
      const tdFs = document.createElement("td");
      const fs = document.createElement("input");
      fs.type = "number"; fs.min = 12; fs.max = 60; fs.value = sub.fontSize;
      fs.addEventListener("change", () => {
        sub.fontSize = parseInt(fs.value, 10) || 28;
        sub.manual = false;
        state.layoutDirty = true;
      });
      tdFs.appendChild(fs);
      tr.appendChild(tdPri);
      tr.appendChild(tdFs);
      tbody.appendChild(tr);
    }
  }

  // ---- 导出 WebVTT ----
  function fmt(t) {
    const m = Math.floor(t / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000);
    const pad = (n, l) => String(n).padStart(l, "0");
    return `${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
  }
  function exportVTT() {
    let out = "WEBVTT\n\n";
    for (const sub of subtitles) {
      const line = Math.round(sub.pos.y * 100);
      const pos = Math.round(sub.pos.x * 100);
      out += `${sub.id}\n00:${fmt(sub.start)} --> 00:${fmt(sub.end)} line:${line}% position:${pos}% align:center\n${sub.text}\n\n`;
    }
    download(new Blob([out], { type: "text/vtt" }), "subtitles.vtt");
  }

  // ---- 导出避让预览图 ----
  function exportPNG() {
    render();
    canvas.toBlob((blob) => download(blob, "avoidance-preview.png"), "image/png");
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  document.getElementById("btnAuto").addEventListener("click", () => {
    for (const s of subtitles) s.manual = false;
    alertBox.classList.add("hidden");
    state.layoutDirty = true;
  });
  document.getElementById("btnVtt").addEventListener("click", exportVTT);
  document.getElementById("btnPng").addEventListener("click", exportPNG);

  // ---- 启动 ----
  layout();
  syncTransport();
  requestAnimationFrame(tick);
})();
