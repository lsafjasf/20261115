"use strict";

/* ---------------- 种子随机 ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getSeed() {
  const p = new URLSearchParams(location.search);
  if (p.has("seed")) return parseInt(p.get("seed"), 10) >>> 0;
  const s = (Math.random() * 0xffffffff) >>> 0;
  p.set("seed", s);
  history.replaceState(null, "", "?" + p.toString());
  return s;
}

/* ---------------- 模板与变体生成 ---------------- */
const TEMPLATE_TYPES = ["pluck", "pad", "bell"];
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];

function makeTemplates(rng) {
  return TEMPLATE_TYPES.map((type, id) => {
    const base = 180 + Math.floor(rng() * 160); // 基频
    const notes = [];
    const n = type === "pad" ? 3 : 5;
    for (let i = 0; i < n; i++) {
      notes.push(base * Math.pow(2, SCALE[Math.floor(rng() * SCALE.length)] / 12));
    }
    return { id, type, base, notes };
  });
}

function makeVariantParams(rng) {
  return {
    cutoff: 600 + Math.floor(rng() * 3400),      // 低通滤波截止 Hz
    q: 0.5 + Math.round(rng() * 95) / 10,        // 0.5 ~ 10
    delayMs: 60 + Math.floor(rng() * 380),       // 延迟时间 ms
    feedback: Math.round(rng() * 55) / 100,      // 0 ~ 0.55
    wet: 0.25 + Math.round(rng() * 40) / 100,    // 延迟湿声比例
  };
}

function makeClips(seed) {
  const rng = mulberry32(seed);
  const templates = makeTemplates(rng);
  const clips = [];
  for (const tpl of templates) {
    for (let v = 0; v < 2; v++) {
      clips.push({ templateId: tpl.id, variant: v, params: makeVariantParams(rng) });
    }
  }
  // Fisher-Yates 洗牌（同一 rng，保证同 seed 顺序一致）
  for (let i = clips.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [clips[i], clips[j]] = [clips[j], clips[i]];
  }
  return { templates, clips };
}

/* ---------------- 音频合成（实时 / 离线共用） ---------------- */
const CLIP_LEN = 1.6;   // 音符部分时长
const TAIL = 0.9;       // 延迟尾音
const RENDER_LEN = CLIP_LEN + TAIL;

function buildGraph(ctx, tpl, params, destination) {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = params.cutoff;
  filter.Q.value = params.q;

  const dry = ctx.createGain();
  dry.gain.value = 1.0;
  filter.connect(dry).connect(destination);

  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = params.delayMs / 1000;
  const fb = ctx.createGain();
  fb.gain.value = params.feedback;
  const wet = ctx.createGain();
  wet.gain.value = params.wet;
  filter.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(wet).connect(destination);

  const t0 = ctx.currentTime + 0.02;
  const step = CLIP_LEN / tpl.notes.length;
  tpl.notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const t = t0 + i * step;
    if (tpl.type === "pluck") {
      osc.type = "square";
      env.gain.setValueAtTime(0.5, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + step * 0.95);
    } else if (tpl.type === "pad") {
      osc.type = "sawtooth";
      osc.detune.value = (i % 2 === 0 ? 6 : -6);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(0.3, t + step * 0.4);
      env.gain.linearRampToValueAtTime(0.0001, t + step * 1.1);
    } else { // bell
      osc.type = "sine";
      env.gain.setValueAtTime(0.6, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + step * 1.4);
    }
    osc.frequency.value = freq;
    osc.connect(env).connect(filter);
    osc.start(t);
    osc.stop(t + step * 1.5);
  });
}

async function renderClip(tpl, params) {
  const ctx = new OfflineAudioContext(1, Math.ceil(RENDER_LEN * 44100), 44100);
  buildGraph(ctx, tpl, params, ctx.destination);
  return ctx.startRendering();
}

/* ---------------- FFT 与相似度 ---------------- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi;
        const vi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr; cwr = nwr;
      }
    }
  }
}

// 平均对数幅度谱（多帧滑动窗口）
function averageSpectrum(samples) {
  const N = 2048, hop = 1024;
  const bins = N / 2;
  const acc = new Float64Array(bins);
  let frames = 0;
  for (let start = 0; start + N <= samples.length; start += hop) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1))); // Hann
      re[i] = samples[start + i] * w;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) {
      const mag = Math.hypot(re[b], im[b]) + 1e-9;
      acc[b] += Math.log(mag);
    }
    frames++;
  }
  for (let b = 0; b < bins; b++) acc[b] /= Math.max(frames, 1);
  return acc;
}

// 余弦相似度（均值中心化的对数谱），映射到 0~1
function spectralSimilarity(specA, specB) {
  const n = Math.min(specA.length, specB.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += specA[i]; mb += specB[i]; }
  ma /= n; mb /= n;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const a = specA[i] - ma, b = specB[i] - mb;
    dot += a * b; na += a * a; nb += b * b;
  }
  const cos = dot / (Math.sqrt(na * nb) + 1e-12);
  return Math.max(0, Math.min(1, (cos + 1) / 2));
}

/* ---------------- 频谱绘制 ---------------- */
function drawSpectrum(canvas, spec) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext("2d");
  g.scale(dpr, dpr);
  g.fillStyle = "#0b0e14";
  g.fillRect(0, 0, w, h);
  const minF = 40, maxF = 12000, sr = 44100;
  const bins = spec.length;
  const grad = g.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, "#2b6cb0");
  grad.addColorStop(1, "#63b3ed");
  g.fillStyle = grad;
  for (let x = 0; x < w; x++) {
    const f = minF * Math.pow(maxF / minF, x / w); // 对数频率轴
    const b = Math.min(bins - 1, Math.floor((f / (sr / 2)) * bins));
    const v = (spec[b] + 6) / 6; // 归一化（log 幅度大致落在 [-6, 0]）
    const bh = Math.max(1, Math.min(1, v) * h);
    g.fillRect(x, h - bh, 1, bh);
  }
}

/* ---------------- 游戏状态与 UI ---------------- */
const NAMES = ["甲", "乙", "丙", "丁", "戊", "己"];
const MAX_ERRORS = 2;

const game = {
  seed: 0,
  templates: [],
  clips: [],        // { templateId, variant, params, buffer, spectrum, el }
  selected: -1,
  matched: 0,
  errors: 0,
  pairs: [],        // { a, b, ok, similarity }
  over: false,
  audioCtx: null,
};
window.__game = game; // 测试钩子（界面不展示任何参数）

function playClip(i) {
  if (!game.audioCtx) game.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const ctx = game.audioCtx;
  if (ctx.state === "suspended") ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = game.clips[i].buffer;
  src.connect(ctx.destination);
  src.start();
}

function updateStatus() {
  document.getElementById("score").textContent = `已配对 ${game.matched} / 3`;
  const err = document.getElementById("errors");
  err.textContent = `错误 ${game.errors} / ${MAX_ERRORS}`;
  err.classList.toggle("bad", game.errors > 0);
}

function cardCenter(el) {
  const wrap = document.getElementById("board-wrap").getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - wrap.left + r.width / 2, y: r.top - wrap.top + r.height / 2 };
}

function drawLines() {
  const canvas = document.getElementById("lines");
  const wrap = document.getElementById("board-wrap");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = wrap.clientWidth * dpr;
  canvas.height = wrap.clientHeight * dpr;
  const g = canvas.getContext("2d");
  g.scale(dpr, dpr);
  g.clearRect(0, 0, wrap.clientWidth, wrap.clientHeight);
  for (const p of game.pairs) {
    const c1 = cardCenter(game.clips[p.a].el);
    const c2 = cardCenter(game.clips[p.b].el);
    g.strokeStyle = p.ok ? "rgba(72,187,120,.9)" : "rgba(245,101,101,.9)";
    g.lineWidth = 3;
    g.setLineDash(p.ok ? [] : [8, 6]);
    g.beginPath();
    g.moveTo(c1.x, c1.y);
    g.lineTo(c2.x, c2.y);
    g.stroke();
  }
}

function lockPair(a, b) {
  const ca = game.clips[a], cb = game.clips[b];
  const ok = ca.templateId === cb.templateId;
  const similarity = spectralSimilarity(ca.spectrum, cb.spectrum);
  game.pairs.push({ a, b, ok, similarity });
  for (const i of [a, b]) {
    const el = game.clips[i].el;
    el.classList.remove("selected");
    el.classList.add("locked", ok ? "ok" : "fail");
    el.querySelector(".tag").textContent = ok ? "✓ 锁定" : "✗ 锁定";
  }
  if (ok) game.matched++; else game.errors++;
  updateStatus();
  drawLines();
  if (game.errors >= MAX_ERRORS) endGame(false);
  else if (game.matched === 3) endGame(true);
}

function onCardClick(i) {
  if (game.over) return;
  const clip = game.clips[i];
  if (clip.el.classList.contains("locked")) return;
  playClip(i);
  if (game.selected === -1) {
    game.selected = i;
    clip.el.classList.add("selected");
  } else if (game.selected === i) {
    game.selected = -1;
    clip.el.classList.remove("selected");
  } else {
    const a = game.selected;
    game.selected = -1;
    lockPair(a, i);
  }
}

/* ---------------- 结算与初始化 ---------------- */
function endGame(won) {
  game.over = true;
  if (game.selected !== -1) {
    game.clips[game.selected].el.classList.remove("selected");
    game.selected = -1;
  }
  const box = document.getElementById("result");
  box.classList.remove("hidden");
  document.getElementById("result-title").textContent =
    won ? "🎉 全部配对成功！" : "💥 错误已达 2 次，挑战失败";
  const tbody = document.querySelector("#result-table tbody");
  tbody.innerHTML = "";
  game.pairs.forEach((p, idx) => {
    const rows = [p.a, p.b].map((ci, k) => {
      const c = game.clips[ci];
      const tpl = game.templates[c.templateId];
      const pr = c.params;
      return `<tr>
        ${k === 0 ? `<td rowspan="2">#${idx + 1}</td>` : ""}
        <td>${NAMES[ci]}</td>
        <td>${tpl.type} (#${c.templateId + 1})</td>
        <td>${pr.cutoff}</td><td>${pr.q.toFixed(1)}</td>
        <td>${pr.delayMs}</td><td>${pr.feedback.toFixed(2)}</td>
        ${k === 0 ? `<td rowspan="2">${(p.similarity * 100).toFixed(1)}%</td>
        <td rowspan="2" class="${p.ok ? "ok" : "fail"}">${p.ok ? "✓ 正确" : "✗ 错误"}</td>` : ""}
      </tr>`;
    });
    tbody.innerHTML += rows.join("");
  });
}

async function init() {
  game.seed = getSeed();
  document.getElementById("seed-label").textContent = `seed: ${game.seed}`;
  const { templates, clips } = makeClips(game.seed);
  game.templates = templates;
  game.clips = clips;
  game.selected = -1;
  game.matched = 0;
  game.errors = 0;
  game.pairs = [];
  game.over = false;

  const board = document.getElementById("board");
  board.innerHTML = "";
  document.getElementById("result").classList.add("hidden");

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    c.buffer = await renderClip(templates[c.templateId], c.params);
    c.spectrum = averageSpectrum(c.buffer.getChannelData(0));
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.index = i;
    el.innerHTML = `<div class="name">音频 ${NAMES[i]}</div><span class="tag"></span><canvas></canvas>`;
    el.addEventListener("click", () => onCardClick(i));
    board.appendChild(el);
    c.el = el;
    drawSpectrum(el.querySelector("canvas"), c.spectrum);
  }
  updateStatus();
  drawLines();
}

document.getElementById("restart").addEventListener("click", () => {
  window.__ready = init();
});
document.getElementById("new-seed").addEventListener("click", () => {
  const p = new URLSearchParams(location.search);
  p.set("seed", (Math.random() * 0xffffffff) >>> 0);
  location.search = p.toString();
});
window.addEventListener("resize", drawLines);

window.__ready = init();
