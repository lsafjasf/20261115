"use strict";

// ---------- 全局状态 ----------
const TOTAL_FRAMES = 240; // 动画总帧数
const state = {
  fps: 24,
  playhead: 0,
  playing: false,
  cues: [], // {id, text, inFrame, outFrame}
  nextCueId: 1,
  savedSnapshot: null,
};

// 内置字幕条目（帧号定义，切换帧率时帧不变、时间码重算）
const BUILTIN_CUES = [
  { text: "第一幕：小球登场", inFrame: 12, outFrame: 60 },
  { text: "它越弹越高", inFrame: 72, outFrame: 132 },
  { text: "落幕，感谢观看", inFrame: 144, outFrame: 216 },
];

const CUE_COLORS = ["#4da3ff", "#4fd18b", "#ffb84d", "#c58bff", "#ff8bd1"];

const stageCanvas = document.getElementById("stage-canvas");
const stageCtx = stageCanvas.getContext("2d");
const timelineCanvas = document.getElementById("timeline-canvas");
const timelineCtx = timelineCanvas.getContext("2d");

function cueColor(index) {
  return CUE_COLORS[index % CUE_COLORS.length];
}

function activeCueAt(frame) {
  return state.cues.findIndex((c) => frame >= c.inFrame && frame < c.outFrame);
}

// ---------- 舞台：逐帧动画 + 当前字幕 ----------
function drawStage() {
  const { width, height } = stageCanvas;
  const ctx = stageCtx;
  const f = state.playhead;
  ctx.clearRect(0, 0, width, height);

  // 背景网格
  ctx.fillStyle = "#0b0e13";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  for (let x = 0; x < width; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }

  // 逐帧动画：弹跳小球（帧号的确定函数）
  const groundY = height - 60;
  const period = 60;
  const phase = (f % period) / period;
  const bounce = Math.abs(Math.sin(phase * Math.PI));
  const ballX = 80 + ((f * 3) % (width - 160));
  const ballY = groundY - bounce * 180;
  ctx.strokeStyle = "#3a4356";
  ctx.beginPath(); ctx.moveTo(0, groundY + 20); ctx.lineTo(width, groundY + 20); ctx.stroke();
  ctx.fillStyle = "#ffb84d";
  ctx.beginPath(); ctx.arc(ballX, ballY, 18, 0, Math.PI * 2); ctx.fill();

  // 帧号与时间码水印
  ctx.fillStyle = "#8b94a5";
  ctx.font = "14px ui-monospace, monospace";
  ctx.fillText(`帧 ${f} / ${TOTAL_FRAMES - 1}`, 12, 22);
  ctx.fillStyle = "#4da3ff";
  ctx.fillText(Timecode.frameToTimecode(f, state.fps) + " @ " + state.fps + "fps", 12, 42);

  // 当前帧命中的字幕
  const idx = activeCueAt(f);
  if (idx >= 0) {
    const cue = state.cues[idx];
    ctx.font = "22px 'PingFang SC', 'Microsoft YaHei', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    const textWidth = ctx.measureText(cue.text).width;
    ctx.fillRect(width / 2 - textWidth / 2 - 12, height - 48, textWidth + 24, 34);
    ctx.fillStyle = "#fff";
    ctx.fillText(cue.text, width / 2, height - 24);
    ctx.textAlign = "left";
  }
}

// ---------- 时间轴：帧标尺 + 字幕块 + 播放头 ----------
function resizeTimeline() {
  const cssWidth = timelineCanvas.clientWidth || timelineCanvas.parentElement.clientWidth - 28;
  timelineCanvas.width = Math.max(320, cssWidth);
}

function frameToX(frame) {
  const pad = 12;
  return pad + (frame / (TOTAL_FRAMES - 1)) * (timelineCanvas.width - pad * 2);
}

function xToFrame(x) {
  const pad = 12;
  const ratio = (x - pad) / (timelineCanvas.width - pad * 2);
  return Math.min(TOTAL_FRAMES - 1, Math.max(0, Math.round(ratio * (TOTAL_FRAMES - 1))));
}

function drawTimeline() {
  const { width, height } = timelineCanvas;
  const ctx = timelineCtx;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#10141b";
  ctx.fillRect(0, 0, width, height);

  // 帧标尺：每帧小刻度，每秒大刻度（随帧率变化）
  ctx.strokeStyle = "#2e3542";
  ctx.fillStyle = "#8b94a5";
  ctx.font = "10px ui-monospace, monospace";
  for (let f = 0; f < TOTAL_FRAMES; f++) {
    const x = frameToX(f);
    const isSecond = f % state.fps === 0;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, isSecond ? 18 : 8);
    ctx.stroke();
    if (isSecond) {
      ctx.fillText(Timecode.frameToTimecode(f, state.fps), x + 2, 28);
    }
  }

  // 字幕区间块
  const conflicts = new Set(Timecode.findOverlaps(state.cues).flat());
  state.cues.forEach((cue, i) => {
    const x1 = frameToX(cue.inFrame);
    const x2 = frameToX(cue.outFrame);
    ctx.fillStyle = conflicts.has(cue.id) ? "rgba(255,93,93,0.7)" : cueColor(i) + "b3";
    ctx.fillRect(x1, 40, Math.max(2, x2 - x1), 28);
    ctx.fillStyle = "#0b0e13";
    ctx.font = "11px sans-serif";
    ctx.fillText(`#${cue.id}`, x1 + 4, 57);
  });

  // 播放头
  const px = frameToX(state.playhead);
  ctx.strokeStyle = "#ff5d5d";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = "#ff5d5d";
  ctx.beginPath();
  ctx.moveTo(px - 6, 0); ctx.lineTo(px + 6, 0); ctx.lineTo(px, 10);
  ctx.closePath(); ctx.fill();
}

// 拖动时间轴移动播放头
let scrubbing = false;
function scrubTo(event) {
  const rect = timelineCanvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * timelineCanvas.width;
  setPlayhead(xToFrame(x));
}
timelineCanvas.addEventListener("pointerdown", (e) => {
  scrubbing = true;
  timelineCanvas.setPointerCapture(e.pointerId);
  scrubTo(e);
});
timelineCanvas.addEventListener("pointermove", (e) => {
  if (scrubbing) scrubTo(e);
});
timelineCanvas.addEventListener("pointerup", () => {
  scrubbing = false;
});

// ---------- 字幕表格 ----------
const cueTableBody = document.querySelector("#cue-table tbody");
const saveBtn = document.getElementById("save-btn");
const saveStatus = document.getElementById("save-status");

function renderCueTable() {
  const conflicts = new Set(Timecode.findOverlaps(state.cues).flat());
  const activeIdx = activeCueAt(state.playhead);
  cueTableBody.innerHTML = "";
  state.cues.forEach((cue, i) => {
    const tr = document.createElement("tr");
    tr.dataset.cueId = cue.id;
    if (i === activeIdx) tr.classList.add("active-cue");
    if (conflicts.has(cue.id)) tr.classList.add("conflict");

    const inTc = Timecode.frameToTimecode(cue.inFrame, state.fps);
    const outTc = Timecode.frameToTimecode(cue.outFrame, state.fps);
    tr.innerHTML = `
      <td class="mono">${cue.id}</td>
      <td><input type="text" class="cue-text" value="" /></td>
      <td><input type="number" class="cue-in" min="0" max="${TOTAL_FRAMES - 1}" value="${cue.inFrame}" /></td>
      <td><input type="number" class="cue-out" min="0" max="${TOTAL_FRAMES}" value="${cue.outFrame}" /></td>
      <td class="mono tc-in">${inTc}</td>
      <td class="mono tc-out">${outTc}</td>
      <td class="cue-state">${conflicts.has(cue.id) ? "⚠ 重叠" : "✓"}</td>
      <td><button class="cue-delete" title="删除">✕</button></td>`;
    const textInput = tr.querySelector(".cue-text");
    textInput.value = cue.text;

    textInput.addEventListener("input", () => {
      cue.text = textInput.value;
      refreshValidation();
    });
    tr.querySelector(".cue-in").addEventListener("change", (e) => {
      cue.inFrame = clampFrame(parseInt(e.target.value, 10));
      renderAll();
    });
    tr.querySelector(".cue-out").addEventListener("change", (e) => {
      cue.outFrame = clampFrame(parseInt(e.target.value, 10));
      renderAll();
    });
    tr.querySelector(".cue-delete").addEventListener("click", () => {
      state.cues = state.cues.filter((c) => c.id !== cue.id);
      renderAll();
    });
    cueTableBody.appendChild(tr);
  });
}

function clampFrame(value) {
  if (Number.isNaN(value)) return 0;
  return Math.min(TOTAL_FRAMES, Math.max(0, value));
}

// 重叠校验：有重叠或非法数据时阻止保存
function refreshValidation() {
  const errors = Timecode.validateCues(state.cues);
  saveBtn.disabled = errors.length > 0;
  if (errors.length > 0) {
    saveStatus.textContent = errors.join("；");
    saveStatus.className = "status error";
  } else if (state.savedSnapshot !== JSON.stringify(state.cues)) {
    saveStatus.textContent = "有未保存的修改";
    saveStatus.className = "status";
  } else {
    saveStatus.textContent = "已保存";
    saveStatus.className = "status ok";
  }
  return errors;
}

saveBtn.addEventListener("click", () => {
  const errors = refreshValidation();
  if (errors.length > 0) return; // 重叠阻止保存
  state.savedSnapshot = JSON.stringify(state.cues);
  refreshValidation();
});

document.getElementById("import-builtin-btn").addEventListener("click", () => {
  state.cues = BUILTIN_CUES.map((c) => ({ ...c, id: state.nextCueId++ }));
  renderAll();
});

document.getElementById("add-cue-btn").addEventListener("click", () => {
  const start = state.playhead;
  state.cues.push({ id: state.nextCueId++, text: "新字幕", inFrame: start, outFrame: Math.min(TOTAL_FRAMES, start + state.fps) });
  renderAll();
});

document.getElementById("export-vtt-btn").addEventListener("click", () => {
  const preview = document.getElementById("vtt-preview");
  try {
    const vtt = Timecode.toWebVtt(state.cues, state.fps);
    preview.textContent = vtt;
    const blob = new Blob([vtt], { type: "text/vtt" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `subtitles-${state.fps}fps.vtt`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (err) {
    preview.textContent = `导出失败：${err.message}`;
  }
});

// ---------- 播放与节拍参考（Web Audio）----------
const playBtn = document.getElementById("play-btn");
const metronomeBtn = document.getElementById("metronome-btn");
const readout = document.getElementById("playhead-readout");

let audioCtx = null;
let metronomeOn = false;

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

// 短促咔嗒声：每秒边界高音重拍，半秒中音，其余帧静默
function click(accent) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = accent === "strong" ? 1568 : 1046;
  gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.06);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.07);
}

function maybeTick(frame) {
  if (!metronomeOn || !audioCtx) return;
  if (frame % state.fps === 0) click("strong");
  else if (frame % Math.round(state.fps / 2) === 0) click("weak");
}

metronomeBtn.addEventListener("click", () => {
  ensureAudio();
  metronomeOn = !metronomeOn;
  metronomeBtn.textContent = metronomeOn ? "♩ 节拍参考：开" : "♩ 节拍参考：关";
  metronomeBtn.setAttribute("aria-pressed", String(metronomeOn));
});

let lastTickTime = 0;
function playbackLoop(now) {
  if (!state.playing) return;
  const frameDur = 1000 / state.fps;
  if (now - lastTickTime >= frameDur) {
    lastTickTime = now - ((now - lastTickTime) % frameDur);
    setPlayhead(state.playhead + 1);
    maybeTick(state.playhead);
    if (state.playhead >= TOTAL_FRAMES - 1) stopPlayback();
  }
  requestAnimationFrame(playbackLoop);
}

function startPlayback() {
  ensureAudio();
  state.playing = true;
  playBtn.textContent = "⏸ 暂停";
  lastTickTime = performance.now();
  requestAnimationFrame(playbackLoop);
}

function stopPlayback() {
  state.playing = false;
  playBtn.textContent = "▶ 播放";
}

playBtn.addEventListener("click", () => {
  if (state.playing) stopPlayback();
  else startPlayback();
});

// ---------- 帧率切换：帧号不变，时间码全部重算 ----------
document.querySelectorAll(".fps-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const fps = Number(btn.dataset.fps);
    if (fps === state.fps) return;
    state.fps = fps;
    document.querySelectorAll(".fps-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderAll();
  });
});

// ---------- 渲染入口 ----------
function setPlayhead(frame) {
  state.playhead = Math.min(TOTAL_FRAMES - 1, Math.max(0, frame));
  renderAll();
}

function renderAll() {
  drawStage();
  drawTimeline();
  renderCueTable();
  readout.textContent = `帧 ${state.playhead} · ${Timecode.frameToTimecode(state.playhead, state.fps)}`;
  refreshValidation();
}

window.addEventListener("resize", () => {
  resizeTimeline();
  drawTimeline();
});

resizeTimeline();
renderAll();
