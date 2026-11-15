"use strict";

// ---------- 全局常量 ----------
const SR = 44100;
const DURATION = 10; // 秒

// 主旋律：简单的五声音阶序列（频率, 起始秒, 时长秒）
const MELODY = [
  [261.63, 0.0, 0.8], [293.66, 1.0, 0.8], [329.63, 2.0, 0.8],
  [392.00, 3.0, 0.8], [440.00, 4.0, 0.8], [392.00, 5.0, 0.8],
  [329.63, 6.0, 0.8], [293.66, 7.0, 0.8], [261.63, 8.0, 1.6],
];

// ---------- 素材合成：主旋律 + 持续低频轰鸣 ----------
async function buildSourceBuffer() {
  const ctx = new OfflineAudioContext(1, SR * DURATION, SR);

  // 主旋律：三角波 + 指数包络
  for (const [freq, start, dur] of MELODY) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(0.45, start + 0.03);
    env.gain.setTargetAtTime(0, start + dur * 0.6, 0.12);
    osc.connect(env).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.5);
  }

  // 低频轰鸣：50 Hz 基波 + 100 Hz 泛音 + 低通滤波噪声
  const hum1 = ctx.createOscillator();
  hum1.type = "sine";
  hum1.frequency.value = 50;
  const hum1Gain = ctx.createGain();
  hum1Gain.gain.value = 0.5;
  hum1.connect(hum1Gain).connect(ctx.destination);
  hum1.start(0);

  const hum2 = ctx.createOscillator();
  hum2.type = "sine";
  hum2.frequency.value = 100;
  const hum2Gain = ctx.createGain();
  hum2Gain.gain.value = 0.22;
  hum2.connect(hum2Gain).connect(ctx.destination);
  hum2.start(0);

  // 低频随机轰鸣（棕色噪声经 120 Hz 低通）
  const noiseLen = SR * DURATION;
  const noiseBuf = ctx.createBuffer(1, noiseLen, SR);
  const data = noiseBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < noiseLen; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;
  const noiseLp = ctx.createBiquadFilter();
  noiseLp.type = "lowpass";
  noiseLp.frequency.value = 120;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.35;
  noise.connect(noiseLp).connect(noiseGain).connect(ctx.destination);
  noise.start(0);

  return ctx.startRendering();
}

// ---------- 参数状态（UI 与导出共用同一份） ----------
const params = {
  A: { hp: 120, notchF: 50, notchQ: 8, gate: -45, bypass: false },
  B: { hp: 80, notchF: 100, notchQ: 6, gate: -50, bypass: false },
};

// 在任意 BaseAudioContext 上构建一条修复链。
// 返回 { input, output }；旁路的组直接跳过，保证导出与监听状态一致。
function buildChain(ctx) {
  const input = ctx.createGain();
  let node = input;

  for (const key of ["A", "B"]) {
    const p = params[key];
    if (p.bypass) continue;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = p.hp;
    hp.Q.value = 0.707;

    const notch = ctx.createBiquadFilter();
    notch.type = "notch";
    notch.frequency.value = p.notchF;
    notch.Q.value = p.notchQ;

    // 动态门限：高压缩比 + 快启动，低于阈值的残余轰鸣被压下
    const gate = ctx.createDynamicsCompressor();
    gate.threshold.value = p.gate;
    gate.knee.value = 2;
    gate.ratio.value = 20;
    gate.attack.value = 0.003;
    gate.release.value = 0.25;

    node.connect(hp);
    hp.connect(notch);
    notch.connect(gate);
    node = gate;
  }

  const output = ctx.createGain();
  node.connect(output);
  return { input, output };
}

// ---------- 低频能量测量（用于验证修复效果） ----------
function lowBandRms(buffer, lo = 20, hi = 150) {
  // 用 Goertzel 思路对 20–150 Hz 逐 10 Hz 取幅值，近似低频频段能量
  const x = buffer.getChannelData(0);
  const n = x.length;
  let sum = 0;
  let count = 0;
  for (let f = lo; f <= hi; f += 10) {
    const w = (2 * Math.PI * f) / SR;
    const coeff = 2 * Math.cos(w);
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = 0; i < n; i++) {
      s0 = x[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    sum += Math.sqrt(Math.max(power, 0)) / n;
    count++;
  }
  return sum / count;
}

// ---------- 实时播放 ----------
let liveCtx = null;
let liveSource = null;
let analyser = null;
let sourceBuffer = null;

function ensureLiveGraph(mode) {
  stopPlayback();
  if (!liveCtx) {
    liveCtx = new AudioContext({ sampleRate: SR });
    analyser = liveCtx.createAnalyser();
    analyser.fftSize = 2048;
  }
  liveSource = liveCtx.createBufferSource();
  liveSource.buffer = sourceBuffer;
  if (mode === "fixed") {
    const chain = buildChain(liveCtx);
    liveSource.connect(chain.input);
    chain.output.connect(analyser);
  } else {
    liveSource.connect(analyser);
  }
  analyser.connect(liveCtx.destination);
  liveSource.start();
  document.getElementById("playState").textContent =
    (mode === "fixed" ? "播放修复后" : "播放污染原音") +
    ` · 旁路 A=${params.A.bypass} B=${params.B.bypass}`;
}

function stopPlayback() {
  if (liveSource) {
    try { liveSource.stop(); } catch (e) { /* 未启动 */ }
    liveSource.disconnect();
    liveSource = null;
  }
  const el = document.getElementById("playState");
  if (el) el.textContent = "空闲";
}

// ---------- Canvas 可视化 ----------
const spectrumCanvas = document.getElementById("spectrum");
const waveformCanvas = document.getElementById("waveform");
const chainCanvas = document.getElementById("chain");

function drawSpectrum() {
  const c = spectrumCanvas.getContext("2d");
  const w = spectrumCanvas.width, h = spectrumCanvas.height;
  c.fillStyle = "#0b0f13";
  c.fillRect(0, 0, w, h);
  if (!analyser || !liveSource) {
    c.fillStyle = "#8a97a5";
    c.font = "13px sans-serif";
    c.textAlign = "center";
    c.fillText("待机 — 点击播放查看实时频谱", w / 2, h / 2);
    return;
  }
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const binHz = SR / 2 / data.length;
  c.fillStyle = "#4fc08d";
  for (let i = 0; i < data.length; i++) {
    const x = (i / data.length) * w;
    const bh = (data[i] / 255) * h;
    c.fillRect(x, h - bh, w / data.length + 0.5, bh);
  }
  // 标出 50/100 Hz 轰鸣位置
  c.fillStyle = "#e0a44a";
  for (const f of [50, 100]) {
    const x = (f / binHz / data.length) * w;
    c.fillRect(x, 0, 1.5, h);
  }
}

function drawWaveform() {
  const c = waveformCanvas.getContext("2d");
  const w = waveformCanvas.width, h = waveformCanvas.height;
  c.fillStyle = "#0b0f13";
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "#6fb7ff";
  c.beginPath();
  if (analyser && liveSource) {
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    for (let i = 0; i < data.length; i++) {
      const x = (i / data.length) * w;
      const y = (data[i] / 255) * h;
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
  } else if (sourceBuffer) {
    // 空闲时显示污染素材的静态波形
    const data = sourceBuffer.getChannelData(0);
    const step = Math.floor(data.length / w);
    for (let x = 0; x < w; x++) {
      const s = data[x * step];
      const y = (0.5 - s * 0.45) * h;
      x === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    }
  }
  c.stroke();
}

function drawChain() {
  const c = chainCanvas.getContext("2d");
  const w = chainCanvas.width, h = chainCanvas.height;
  c.fillStyle = "#0b0f13";
  c.fillRect(0, 0, w, h);

  const nodes = [{ label: "污染源", bypass: false }];
  for (const key of ["A", "B"]) {
    const p = params[key];
    nodes.push(
      { label: `高通${key}\n${p.hp}Hz`, bypass: p.bypass },
      { label: `陷波${key}\n${p.notchF}Hz Q${p.notchQ}`, bypass: p.bypass },
      { label: `门限${key}\n${p.gate}dB`, bypass: p.bypass },
    );
  }
  nodes.push({ label: "输出", bypass: false });

  const bw = 78, bh = 46, gap = (w - nodes.length * bw) / (nodes.length + 1);
  const y = (h - bh) / 2;
  nodes.forEach((n, i) => {
    const x = gap + i * (bw + gap);
    if (i > 0) {
      c.strokeStyle = n.bypass ? "#555" : "#4fc08d";
      c.beginPath();
      c.moveTo(x - gap, y + bh / 2);
      c.lineTo(x, y + bh / 2);
      c.stroke();
    }
    c.fillStyle = n.bypass ? "#2a2f36" : "#1d3a2d";
    c.strokeStyle = n.bypass ? "#555" : "#4fc08d";
    c.fillRect(x, y, bw, bh);
    c.strokeRect(x, y, bw, bh);
    c.fillStyle = n.bypass ? "#8a97a5" : "#d7e0e8";
    c.font = "10px sans-serif";
    c.textAlign = "center";
    const lines = n.label.split("\n");
    lines.forEach((t, j) => c.fillText(t, x + bw / 2, y + 18 + j * 13));
    if (n.bypass) {
      c.fillStyle = "#e0a44a";
      c.fillText("旁路", x + bw / 2, y - 4);
    }
  });
}

function updateLowMeter() {
  if (!analyser) return;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  const binHz = SR / 2 / data.length;
  const lo = Math.floor(20 / binHz), hi = Math.ceil(150 / binHz);
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += data[i];
  const avg = sum / (hi - lo + 1) / 255;
  const db = avg > 0 ? (20 * Math.log10(avg)).toFixed(1) : "-∞";
  document.getElementById("lowMeter").style.width = `${Math.min(avg * 100, 100)}%`;
  document.getElementById("lowDb").textContent = `${db} dB`;
}

function vizLoop() {
  drawSpectrum();
  drawWaveform();
  drawChain();
  updateLowMeter();
  requestAnimationFrame(vizLoop);
}

// ---------- WAV 编码（16-bit PCM 单声道） ----------
function encodeWav(buffer) {
  const samples = buffer.getChannelData(0);
  const n = samples.length;
  const out = new ArrayBuffer(44 + n * 2);
  const v = new DataView(out);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);          // PCM
  v.setUint16(22, 1, true);          // 单声道
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

// ---------- 导出：离线渲染走同一条链 ----------
async function renderFixed() {
  const off = new OfflineAudioContext(1, SR * DURATION, SR);
  const src = off.createBufferSource();
  src.buffer = sourceBuffer;
  const chain = buildChain(off);
  src.connect(chain.input);
  chain.output.connect(off.destination);
  src.start(0);
  return off.startRendering();
}

let lastReport = null;

async function exportWav(download = true) {
  const rendered = await renderFixed();
  const rawLow = lowBandRms(sourceBuffer);
  const fixedLow = lowBandRms(rendered);
  const wav = encodeWav(rendered);
  lastReport = {
    durationSec: rendered.duration,
    sampleRate: rendered.sampleRate,
    samples: rendered.length,
    bypass: { A: params.A.bypass, B: params.B.bypass },
    params: JSON.parse(JSON.stringify(params)),
    lowBandBefore: rawLow.toFixed(4),
    lowBandAfter: fixedLow.toFixed(4),
    lowBandReductionDb: (20 * Math.log10(fixedLow / rawLow)).toFixed(1),
  };
  document.getElementById("report").textContent =
    `导出时长: ${lastReport.durationSec.toFixed(3)} s (${lastReport.samples} 采样 @ ${lastReport.sampleRate} Hz)\n` +
    `旁路状态: A=${lastReport.bypass.A}  B=${lastReport.bypass.B}\n` +
    `低频能量(20-150Hz): 修复前 ${lastReport.lowBandBefore} → 修复后 ${lastReport.lowBandAfter}` +
    ` (${lastReport.lowBandReductionDb} dB)`;
  if (download) {
    const blob = new Blob([wav], { type: "audio/wav" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "repaired.wav";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return { wav, report: lastReport };
}

// ---------- UI 绑定 ----------
function refreshGroupUI(key) {
  document.getElementById(`hp${key}Val`).textContent = `${params[key].hp} Hz`;
  document.getElementById(`notch${key}FVal`).textContent = `${params[key].notchF} Hz`;
  document.getElementById(`notch${key}QVal`).textContent = params[key].notchQ;
  document.getElementById(`gate${key}Val`).textContent = `${params[key].gate} dB`;
  document.querySelector(`.group[data-group="${key}"]`).classList.toggle("bypassed", params[key].bypass);
}

function bindGroup(key) {
  const ids = {
    hp: `hp${key}`, notchF_: `notch${key}F`, notchQ_: `notch${key}Q`,
    gate: `gate${key}`, bypass: `bypass${key}`,
  };
  const show = () => refreshGroupUI(key);
  document.getElementById(ids.hp).addEventListener("input", e => { params[key].hp = +e.target.value; show(); });
  document.getElementById(ids.notchF_).addEventListener("input", e => { params[key].notchF = +e.target.value; show(); });
  document.getElementById(ids.notchQ_).addEventListener("input", e => { params[key].notchQ = +e.target.value; show(); });
  document.getElementById(ids.gate).addEventListener("input", e => { params[key].gate = +e.target.value; show(); });
  document.getElementById(ids.bypass).addEventListener("change", e => { params[key].bypass = e.target.checked; show(); });
  show();
}

async function init() {
  sourceBuffer = await buildSourceBuffer();
  document.getElementById("srcInfo").textContent =
    `素材就绪: ${DURATION}s · ${SR} Hz · 主旋律 + 50/100 Hz 低频轰鸣`;
  bindGroup("A");
  bindGroup("B");
  document.getElementById("btnPlayRaw").addEventListener("click", () => ensureLiveGraph("raw"));
  document.getElementById("btnPlayFixed").addEventListener("click", () => ensureLiveGraph("fixed"));
  document.getElementById("btnStop").addEventListener("click", stopPlayback);
  document.getElementById("btnExport").addEventListener("click", () => exportWav(true));
  vizLoop();
  window.__ready = true;
}

// ---------- 自动化接口（无头验证用） ----------
window.__repair = {
  setParams(next) {
    for (const key of ["A", "B"]) {
      if (!next[key]) continue;
      Object.assign(params[key], next[key]);
      const el = document.getElementById(`bypass${key}`);
      if (el) el.checked = params[key].bypass;
      refreshGroupUI(key);
    }
  },
  getParams: () => JSON.parse(JSON.stringify(params)),
  async export() {
    const { wav, report } = await exportWav(false);
    return { wav: Array.from(new Uint8Array(wav)), report };
  },
  getReport: () => lastReport,
};

init();
