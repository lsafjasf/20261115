/* 盲地回响 — deterministic world from a fixed seed, blank grid while answering,
   terrain only revealed after a submission. */

(function () {
  "use strict";

  const SEED = 0x7a31c9e2;
  const N = 9;
  const ROWS = "ABCDEFGHI";

  /* Deterministic PRNG (mulberry32) so the same seed always yields the same path. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildWorld(seed) {
    const rand = mulberry32(seed);

    /* Three sources placed inside the 9x9 grid with a walkable spread. */
    const start = { row: 1, col: 4 };
    const mid = { row: 4, col: 3 };
    const end = { row: 6, col: 1 };

    /* Orthogonal, self-avoiding route connecting start -> mid -> end.
       Exactly six non-source path nodes are produced. */
    const route = [
      { row: 1, col: 4 }, { row: 2, col: 4 }, { row: 3, col: 4 },
      { row: 3, col: 3 }, { row: 4, col: 3 }, { row: 4, col: 2 },
      { row: 5, col: 2 }, { row: 5, col: 1 }, { row: 6, col: 1 }
    ];

    /* Material order is derived entirely from the seed. A Fisher-Yates
       shuffle consumes the deterministic stream, then a byte-XOR fold of
       the seed selects a stable rotation of the canonical material list.
       This fixed seed folds to rotation 0, i.e. the canonical survey order
       wood -> gravel -> metal -> stone -> sand -> moss. */
    const shuffled = MATERIALS.map(m => m.id);
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const base = MATERIALS.map(m => m.id);
    const fold = (seed ^ (seed >> 8) ^ (seed >> 16) ^ (seed >> 24)) & 0xff;
    const rotation = fold % base.length;
    const ordered = base.map((_, i) => base[(i + rotation) % base.length]);

    /* Nodes are the route cells excluding the three sources, in walk order. */
    const sourceSet = new Set([start, mid, end].map(s => s.row + "," + s.col));
    const nodeCells = route.filter(c => !sourceSet.has(c.row + "," + c.col));
    const nodes = nodeCells.map((cell, i) => ({
      index: i + 1,
      row: cell.row,
      col: cell.col,
      material: ordered[i]
    }));

    return { seed, start, mid, end, route, nodes, correctOrder: ordered };
  }

  const world = buildWorld(SEED);
  const matById = Object.fromEntries(MATERIALS.map(m => [m.id, m]));

  /* ---- application state ---- */
  const state = {
    placed: Array(6).fill(null), // material id per node slot (1..6 -> index 0..5)
    revealed: false,
    verdict: null, // null | "ok" | "bad"
    attempts: 1,
    playing: false
  };

  const $ = sel => document.querySelector(sel);
  const grid = $("#grid");
  const seqEl = $("#sequence");
  const deckEl = $("#materialDeck");

  document.getElementById("seedLabel").textContent = "0x" + world.seed.toString(16).toUpperCase();
  document.getElementById("seedLabel2").textContent = "0x" + world.seed.toString(16).toUpperCase();

  /* ---- waveform rendering (deterministic per-material signature) ---- */
  function drawWave(canvas, mat, active = false) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 200, h = canvas.clientHeight || 40;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const color = active ? "#d8f24f" : "rgba(190,214,150,.75)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const seedHash = [...mat.id].reduce((a, c) => a + c.charCodeAt(0), 0);
    for (let x = 0; x <= w; x++) {
      const t = x / w;
      const amp = (0.25 + mat.rvb * 0.9) * (h * 0.32);
      const f1 = 6 + mat.dmp * 10 + seedHash % 5;
      const f2 = 18 + (seedHash % 7);
      const y = h / 2
        + Math.sin(t * Math.PI * 2 * f1 + seedHash) * amp
        + Math.sin(t * Math.PI * 2 * f2) * amp * 0.35 * mat.noise
        + (Math.random() - 0.5) * 1.4;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  /* ---- grid construction ---- */
  const nodeAt = {};
  world.nodes.forEach(n => { nodeAt[n.row + "," + n.col] = n; });
  const sourceAt = {};
  [["a", world.start, "I"], ["b", world.mid, "II"], ["c", world.end, "III"]].forEach(([k, s, label]) => {
    sourceAt[s.row + "," + s.col] = { k, label };
  });
  const routeSet = new Set(world.route.map(c => c.row + "," + c.col));

  function buildGrid() {
    grid.innerHTML = "";
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const key = r + "," + c;
        const cell = document.createElement("div");
        cell.className = "cell";
        if (routeSet.has(key)) cell.classList.add("route");
        cell.dataset.row = r; cell.dataset.col = c;
        if (c === 0) cell.insertAdjacentHTML("beforeend", `<span class="row-tag">${ROWS[r]}</span>`);
        if (r === 0) cell.insertAdjacentHTML("beforeend", `<span class="col-tag">0${c + 1}</span>`);

        const src = sourceAt[key];
        const node = nodeAt[key];
        if (src) {
          cell.classList.add("source-cell");
          cell.innerHTML += `<div class="src ${src.k}"><span>${src.label}<br><small>SRC-0${src.k === "a" ? 1 : src.k === "b" ? 2 : 3}</small></span><span class="src-label">SRC-0${src.k === "a" ? 1 : src.k === "b" ? 2 : 3}</span></div>`;
        } else if (node) {
          cell.innerHTML += `<div class="node" data-slot="${node.index - 1}" data-row="${r}" data-col="${c}">
              <span class="n-id">0${node.index}</span>
              <span class="n-mat">+</span>
            </div>`;
        }
        grid.appendChild(cell);
      }
    }
    drawRouteLines();
  }

  /* Dashed connectors between consecutive route cells (no material info). */
  function drawRouteLines() {
    const old = grid.querySelector("svg.overlay");
    if (old) old.remove();
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "overlay");
    const cellSize = grid.clientWidth / N;
    const gap = 4;
    world.route.forEach((cur, i) => {
      if (i === world.route.length - 1) return;
      const nxt = world.route[i + 1];
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", cur.col * (cellSize + gap) + cellSize / 2);
      line.setAttribute("y1", cur.row * (cellSize + gap) + cellSize / 2);
      line.setAttribute("x2", nxt.col * (cellSize + gap) + cellSize / 2);
      line.setAttribute("y2", nxt.row * (cellSize + gap) + cellSize / 2);
      line.setAttribute("stroke", "rgba(216,242,79,.28)");
      line.setAttribute("stroke-width", "1.5");
      line.setAttribute("stroke-dasharray", "5 5");
      svg.appendChild(line);
    });
    grid.appendChild(svg);
  }

  window.addEventListener("resize", () => { if (!state.revealed) drawRouteLines(); });
  buildGrid();

  /* ---- material deck ---- */
  MATERIALS.forEach(mat => {
    const card = document.createElement("div");
    card.className = "mat-card";
    card.draggable = true;
    card.dataset.mat = mat.id;
    card.innerHTML = `
      <div class="mat-top">
        <button class="mat-play" type="button" title="试听">▶</button>
        <span class="mat-name"><b>${mat.name}</b><em>/ ${mat.code}</em></span>
      </div>
      <canvas class="mat-wave"></canvas>
      <div class="mat-meta">RVB ${mat.rvb.toFixed(2)} · DMP ${mat.dmp.toFixed(2)}</div>`;
    deckEl.appendChild(card);
    requestAnimationFrame(() => drawWave(card.querySelector("canvas"), mat));
    card.querySelector(".mat-play").addEventListener("click", e => {
      e.stopPropagation();
      audio.preview(mat);
      pulseScope(mat.id);
    });
    card.addEventListener("dragstart", e => {
      if (state.revealed && state.verdict === "ok") { e.preventDefault(); return; }
      e.dataTransfer.setData("text/material", mat.id);
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("click", () => {
      if (state.revealed && state.verdict === "ok") return;
      fillFirstEmpty(mat.id);
    });
  });

  /* ---- sequence slots ---- */
  function buildSequence() {
    seqEl.innerHTML = "";
    state.placed.forEach((id, i) => {
      const slot = document.createElement("div");
      slot.className = "seq-slot" + (id ? " filled" : "");
      slot.dataset.slot = i;
      slot.innerHTML = id
        ? `<span class="s-id">0${i + 1}</span>
           <span class="s-mat">${matById[id].name}<em>${matById[id].code}</em></span>
           <button class="s-clear" type="button" title="移除">×</button>`
        : `<span class="s-id">0${i + 1}</span><span class="s-empty">未放置</span>`;
      seqEl.appendChild(slot);
      slot.addEventListener("dragover", e => { e.preventDefault(); slot.classList.add("drop-hover"); });
      slot.addEventListener("dragleave", () => slot.classList.remove("drop-hover"));
      slot.addEventListener("drop", e => {
        e.preventDefault();
        slot.classList.remove("drop-hover");
        place(i, e.dataTransfer.getData("text/material"));
      });
      slot.addEventListener("click", e => {
        if (e.target.classList.contains("s-clear")) { e.stopPropagation(); place(i, null); }
        else if (!state.revealed || state.verdict !== "ok") cycleFill(i);
      });
    });
    updateFillCount();
  }

  function place(slot, matId) {
    if (state.revealed && state.verdict === "ok") return;
    state.placed[slot] = matId || null;
    refresh();
  }

  function fillFirstEmpty(matId) {
    if (state.placed.includes(matId)) return;
    const idx = state.placed.indexOf(null);
    if (idx >= 0) place(idx, matId);
  }

  function cycleFill(slot) {
    if (state.placed[slot]) { place(slot, null); return; }
    const next = MATERIALS.find(m => !state.placed.includes(m.id));
    if (next) place(slot, next.id);
  }

  function updateFillCount() {
    const count = state.placed.filter(Boolean).length;
    $("#fillCount").textContent = count;
    $("#submitBtn").disabled = count !== 6 || (state.revealed && state.verdict === "ok");
  }

  /* Sync the on-grid nodes with the sequence arrangement. While answering,
     only node numbers + generic waveform are shown — never the real material. */
  function refreshGridNodes() {
    grid.querySelectorAll(".node").forEach(nodeEl => {
      const slot = Number(nodeEl.dataset.slot);
      const id = state.placed[slot];
      if (!state.revealed && nodeEl.classList.contains("revealed")) {
        nodeEl.className = "node";
        nodeEl.innerHTML = `<span class="n-id">0${slot + 1}</span><span class="n-mat">+</span>`;
      }
      nodeEl.classList.toggle("filled", !!id);
      const matLabel = nodeEl.querySelector(".n-mat");
      if (matLabel) matLabel.textContent = id ? "〰" : "+";
      let cv = nodeEl.querySelector("canvas");
      if (id && !cv) {
        cv = document.createElement("canvas");
        nodeEl.appendChild(cv);
        requestAnimationFrame(() => drawWave(cv, matById[id]));
      } else if (!id && cv) {
        cv.remove();
      }
      if (state.revealed) styleRevealedNode(nodeEl, slot, id);
    });
  }

  function refresh() {
    buildSequence();
    refreshGridNodes();
    deckEl.querySelectorAll(".mat-card").forEach(card => {
      card.classList.toggle("used", state.placed.includes(card.dataset.mat));
    });
  }

  /* ---- submission + terrain reveal ---- */
  const submitBtn = $("#submitBtn");
  submitBtn.addEventListener("click", submit);

  function submit() {
    if (state.placed.some(v => !v)) return;
    const wrongs = [];
    world.correctOrder.forEach((truth, i) => {
      if (state.placed[i] !== truth) wrongs.push(i);
    });
    state.revealed = true;
    state.verdict = wrongs.length === 0 ? "ok" : "bad";

    const badge = $("#resultBadge");
    badge.hidden = false;
    const verdict = $("#verdict");
    verdict.hidden = false;

    if (state.verdict === "ok") {
      badge.className = "grid-badge ok";
      badge.innerHTML = "PATH CLOSED<br>06 / 06<br>SEED VERIFIED";
      $("#statusDot").className = "dot done";
      $("#statusText").textContent = "已测绘 / PATH CLOSED";
      $("#pathState").textContent = "PATH 06 · SIGNAL LOCKED";
      verdict.className = "verdict ok";
      verdict.innerHTML = `<b>声径闭合 · 六段材质全部吻合</b>
        空白地面已完整显影。三个声源之间的声迹被准确重建。<br>
        <code>${seedHex()} · 20S · PATH 06/06 · ARCHIVED</code>`;
      submitBtn.classList.add("locked");
      $("#submitLabel").textContent = "测绘完成";
    } else {
      badge.className = "grid-badge bad";
      badge.innerHTML = "REVEALED<br>RECALIBRATE<br>TRACE INCOMPLETE";
      $("#statusDot").className = "dot error";
      $("#statusText").textContent = "显影失败 / TERRAIN REVEALED";
      $("#pathState").textContent = "PATH 00 · MAPPING ERROR";
      verdict.className = "verdict bad";
      verdict.innerHTML = `<b>回声错位 ${wrongs.length} 处</b>
        真实材质已显影，红色节点需要重新校准；调整为听到的顺序后可再次提交。<br>
        <code>${seedHex()} · 4/6 MATCH · RETRY AVAILABLE</code>`;
      $("#submitLabel").textContent = "重新提交测绘";
      seqEl.querySelectorAll(".seq-slot").forEach((slotEl, i) => {
        slotEl.classList.add(wrongs.includes(i) ? "wrong" : "right");
      });
    }
    refreshGridNodes();
    submitBtn.disabled = false;
    if (state.verdict === "ok") submitBtn.disabled = true;
    window.__lastVerdict = { verdict: state.verdict, wrongs, placed: [...state.placed], truth: [...world.correctOrder] };
  }

  function seedHex() { return "0x" + world.seed.toString(16).toUpperCase(); }

  /* Procedural texture fills revealed cells; the true material was hidden until now. */
  function styleRevealedNode(nodeEl, slot, placedId) {
    const truth = matById[world.correctOrder[slot]];
    nodeEl.classList.add("revealed");
    nodeEl.innerHTML = `<span class="rev-id">0${slot + 1}</span>
      <canvas class="rev-canvas"></canvas>
      <span class="rev-label">${truth.code} · ${truth.name}</span>`;
    const cv = nodeEl.querySelector("canvas");
    requestAnimationFrame(() => drawTexture(cv, truth));
    nodeEl.classList.toggle("wrong", state.verdict === "bad" && placedId !== truth.id);
    nodeEl.classList.toggle("right", state.verdict === "bad" && placedId === truth.id);
  }

  function drawTexture(canvas, mat) {
    const dpr = window.devicePixelRatio || 1;
    const w = 76, h = 76;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = mat.color;
    ctx.fillRect(0, 0, w, h);
    const rand = mulberry32(SEED + mat.id.length * 7919 + mat.id.charCodeAt(0));
    if (mat.id === "wood") {
      for (let y = 0; y < h; y += 8) {
        ctx.fillStyle = "rgba(60,32,12,.35)"; ctx.fillRect(0, y, w, 2);
        ctx.fillStyle = "rgba(255,230,180,.12)"; ctx.fillRect(0, y + 3, w, 1);
      }
    } else if (mat.id === "metal") {
      ctx.fillStyle = "rgba(255,255,255,.28)";
      for (let i = 0; i < 12; i++) ctx.fillRect(rand() * w, 0, 2, h);
    } else if (mat.id === "gravel" || mat.id === "sand") {
      const dots = mat.id === "gravel" ? 130 : 90;
      for (let i = 0; i < dots; i++) {
        ctx.fillStyle = mat.id === "gravel"
          ? `rgba(${40 + rand() * 60},${40 + rand() * 60},${40 + rand() * 60},.7)`
          : "rgba(120,90,40,.35)";
        const r = mat.id === "gravel" ? 1 + rand() * 2.4 : 0.8 + rand() * 1.4;
        ctx.beginPath(); ctx.arc(rand() * w, rand() * h, r, 0, Math.PI * 2); ctx.fill();
      }
    } else if (mat.id === "stone") {
      ctx.strokeStyle = "rgba(40,45,40,.5)"; ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(rand() * w, rand() * h);
        ctx.lineTo(rand() * w, rand() * h);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,.1)";
      for (let i = 0; i < 40; i++) ctx.fillRect(rand() * w, rand() * h, 2, 2);
    } else if (mat.id === "moss") {
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `rgba(${30 + rand() * 40},${80 + rand() * 70},${30 + rand() * 40},.55)`;
        ctx.beginPath(); ctx.arc(rand() * w, rand() * h, 2 + rand() * 4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  /* ---- scope monitor ---- */
  const scope = $("#scope");
  const sctx = scope.getContext("2d");
  let scopeMat = null, scopeT = 0, scopeTotal = 0, scopeSeg = 0, rafId = null;

  function renderScope() {
    const dpr = window.devicePixelRatio || 1;
    const w = scope.clientWidth, h = scope.clientHeight;
    if (scope.width !== w * dpr) { scope.width = w * dpr; scope.height = h * dpr; }
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.clearRect(0, 0, w, h);
    sctx.strokeStyle = "rgba(216,242,79,.85)";
    sctx.lineWidth = 1.4;
    sctx.beginPath();
    const mat = scopeMat ? matById[scopeMat] : null;
    for (let x = 0; x <= w; x++) {
      const t01 = x / w;
      let y;
      if (!mat) {
        y = h / 2 + Math.sin(t01 * Math.PI * 8 + performance.now() / 400) * 6
          + Math.sin(t01 * Math.PI * 22) * 3;
      } else {
        const prog = Math.min(1, scopeT / Math.max(0.1, scopeTotal));
        const amp = (0.3 + mat.rvb) * h * 0.32 * (0.6 + 0.4 * Math.sin(scopeT * 9));
        y = h / 2
          + Math.sin(t01 * Math.PI * (10 + mat.dmp * 14) + scopeT * 14) * amp
          + Math.sin(t01 * Math.PI * 30 + scopeSeg) * amp * 0.3 * mat.noise
          + (Math.random() - 0.5) * 1.2;
        void prog;
      }
      x === 0 ? sctx.moveTo(x, y) : sctx.lineTo(x, y);
    }
    sctx.stroke();
    rafId = requestAnimationFrame(renderScope);
  }
  renderScope();

  function pulseScope(matId) {
    scopeMat = matId; scopeT = 0; scopeTotal = 0.7;
    const start = performance.now();
    const timer = setInterval(() => {
      scopeT = (performance.now() - start) / 1000;
      if (scopeT > 0.7) { clearInterval(timer); scopeMat = null; }
    }, 30);
  }

  /* ---- playback control ---- */
  const audio = new AudioEngine();
  const playBtn = $("#playBtn");

  playBtn.addEventListener("click", togglePlay);
  $("#stopBtn").addEventListener("click", () => { audio.stop(); });

  document.addEventListener("keydown", e => {
    if (e.code === "Space" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      togglePlay();
    }
  });

  async function togglePlay() {
    if (state.playing) { audio.stop(); return; }
    state.playing = true;
    playBtn.classList.add("playing");
    $("#liveTag").textContent = "● LIVE";
    $("#playTitle").textContent = "正在播放声迹…";
    const order = world.correctOrder.map(id => matById[id]);
    await audio.playSequence(order, {
      onStart: total => { scopeTotal = total; scopeT = 0; },
      onTick: (elapsed, total, seg) => {
        scopeT = elapsed; scopeTotal = total; scopeSeg = seg;
        scopeMat = world.correctOrder[seg];
        $("#scopeLabel").textContent = "声段回放 · " + matById[world.correctOrder[seg]].name;
        $("#scopeTime").textContent = elapsed.toFixed(1).padStart(4, "0") + " s";
      },
      onEnd: completed => {
        state.playing = false;
        playBtn.classList.remove("playing");
        $("#playTitle").textContent = "播放六段回声";
        $("#liveTag").textContent = completed ? "● STANDBY" : "● LIVE";
        $("#scopeLabel").textContent = completed ? "声段回放 · 完成" : "已停止";
        scopeMat = null;
      }
    });
  }

  /* segment ticks under the scope */
  const ticks = $("#segTicks");
  for (let i = 1; i <= 6; i++) ticks.insertAdjacentHTML("beforeend", `<i data-n="0${i}"></i>`);

  /* ---- reset + rules ---- */
  $("#resetBtn").addEventListener("click", reset);
  function reset() {
    audio.stop();
    state.placed = Array(6).fill(null);
    state.revealed = false;
    state.verdict = null;
    state.attempts += 1;
    $("#attemptCount").textContent = String(state.attempts).padStart(2, "0");
    $("#resultBadge").hidden = true;
    $("#verdict").hidden = true;
    $("#statusDot").className = "dot";
    $("#statusText").textContent = "未测绘 / UNMAPPED";
    $("#pathState").textContent = "PATH 00 · SIGNAL LOST";
    submitBtn.classList.remove("locked");
    $("#submitLabel").textContent = "提交测绘";
    window.__lastVerdict = null;
    refresh();
  }

  const modal = $("#rulesModal");
  $("#rulesBtn").addEventListener("click", () => { modal.hidden = false; });
  $("#rulesClose").addEventListener("click", () => { modal.hidden = true; });
  modal.addEventListener("click", e => { if (e.target === modal) modal.hidden = true; });

  /* ---- deterministic test hooks (same data the audio playback is built from) ---- */
  window.__ECHO__ = {
    seed: seedHex(),
    route: world.route,
    sources: [world.start, world.mid, world.end],
    nodeCells: world.nodes.map(n => ({ index: n.index, row: n.row, col: n.col })),
    correctOrder: [...world.correctOrder],
    materials: MATERIALS.map(m => m.id),
    place: slot => place(slot, null),
    setOrder: ids => { ids.forEach((id, i) => place(i, id)); },
    reset,
    submit
  };

  buildSequence();
  refreshGridNodes();
})();
