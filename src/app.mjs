import {
  FPS, TOTAL_FRAMES, DEFAULT_CUTS, frameToTime, frameDistanceToPeak,
  nearestPeakFrame, validateCuts, shotWeights,
} from './editor-core.mjs';
import { renderShot, renderComposite, makeOffscreenCanvases } from './render.mjs';
import { Timeline } from './timeline.mjs';
import { buildAudioGraph, renderOffline } from './audio-engine.mjs';
import { exportWebM } from './exporter.mjs';

const state = {
  cuts: DEFAULT_CUTS.map((cut) => ({ ...cut })),
  playing: false,
  currentFrame: 0,
  audio: null,
};

const shotCanvases = [0, 1, 2].map((index) => document.getElementById(`shot${index}`));
const previewCanvas = document.getElementById('preview');
const offscreen = makeOffscreenCanvases();
const timeline = new Timeline(document.getElementById('timeline'), state.cuts, refresh);
timeline.bindModeToggle(toggleCutMode);

const els = {
  play: document.getElementById('playBtn'),
  pause: document.getElementById('pauseBtn'),
  restart: document.getElementById('restartBtn'),
  frameInput: document.getElementById('frameInput'),
  readout: document.getElementById('timeReadout'),
  report: document.getElementById('cutReport'),
  audioReport: document.getElementById('audioReport'),
  snap: document.getElementById('snapBtn'),
  audioBtn: document.getElementById('audioBtn'),
  exportBtn: document.getElementById('exportBtn'),
  exportStatus: document.getElementById('exportStatus'),
  badge: document.getElementById('previewBadge'),
};

function toggleCutMode(index) {
  const cut = state.cuts[index];
  cut.mode = cut.mode === 'hard' ? 'crossfade' : 'hard';
  refresh();
}

function renderSourceMonitors(timeS) {
  shotCanvases.forEach((canvas, index) => renderShot(canvas, index, timeS));
}

function renderPreview(timeS) {
  const weights = shotWeights(timeS, state.cuts);
  renderComposite(offscreen, previewCanvas, timeS, weights);
  const active = weights.findIndex((weight) => weight >= 0.999);
  els.badge.textContent = active >= 0
    ? `输出：${['远景', '中景', '特写'][active]}`
    : '交叉淡化中';
  return weights;
}

function updateReadout() {
  const t = frameToTime(state.currentFrame);
  els.readout.textContent = `${t.toFixed(2)}s / 12.00s`;
  els.frameInput.value = String(state.currentFrame);
  timeline.setPlayhead(state.currentFrame);
}

function renderCutReport() {
  const checks = validateCuts(state.cuts);
  els.report.innerHTML = '';
  checks.forEach((check) => {
    const li = document.createElement('li');
    li.className = check.status;
    const modeLabel = check.mode === 'hard' ? '硬切' : '交叉淡化';
    li.innerHTML = `
      <div class="title">
        <span>切点 ${check.index + 1} · ${modeLabel}</span>
        <span>${check.status === 'ok' ? '✓ 合格' : '⚠ 超差'}</span>
      </div>
      <div class="detail">帧 ${check.frame}（${check.time.toFixed(2)}s）· ${check.message}</div>
    `;
    els.report.appendChild(li);
  });
}

function refresh() {
  const timeS = frameToTime(state.currentFrame);
  renderSourceMonitors(timeS);
  renderPreview(timeS);
  updateReadout();
  renderCutReport();
  timeline.draw();
}

let rafId = 0;
let lastWallTime = 0;
function tick(now) {
  if (!state.playing) return;
  if (!lastWallTime) lastWallTime = now;
  const elapsed = (now - lastWallTime) / 1000;
  lastWallTime = now;
  state.currentFrame += Math.round(elapsed * FPS);
  if (state.currentFrame >= TOTAL_FRAMES) {
    state.currentFrame = TOTAL_FRAMES - 1;
    pause();
  }
  refresh();
  rafId = requestAnimationFrame(tick);
}

async function ensureAudio() {
  if (state.audio) {
    await state.audio.ctx.close();
    state.audio = null;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: 48000 });
  await ctx.resume();
  const origin = ctx.currentTime + 0.1;
  const graph = buildAudioGraph(ctx, 12, origin);
  // Gains follow the output timeline from the current frame on; the three
  // ambient beds keep playing through every cut, so no silent holes exist.
  for (let frame = state.currentFrame; frame <= TOTAL_FRAMES; frame += 1) {
    const t = origin + frameToTime(frame - state.currentFrame);
    const weights = shotWeights(frameToTime(frame), state.cuts);
    graph.ambientGains.forEach((gainNode, shotIndex) => {
      gainNode.gain.setValueAtTime(Math.max(0.0001, weights[shotIndex]), t);
    });
  }
  state.audio = { ctx, graph, origin };
}

async function play() {
  if (state.currentFrame >= TOTAL_FRAMES - 1) state.currentFrame = 0;
  state.playing = true;
  await ensureAudio();
  lastWallTime = 0;
  els.badge.textContent = '播放中';
  rafId = requestAnimationFrame(tick);
}

function pause() {
  state.playing = false;
  cancelAnimationFrame(rafId);
  if (state.audio) state.audio.ctx.suspend();
  els.badge.textContent = '已暂停';
  refresh();
}

els.play.addEventListener('click', play);
els.pause.addEventListener('click', pause);
els.restart.addEventListener('click', () => {
  pause();
  state.currentFrame = 0;
  refresh();
});
els.frameInput.addEventListener('change', () => {
  pause();
  state.currentFrame = Math.max(0, Math.min(TOTAL_FRAMES - 1,
    Number(els.frameInput.value) || 0));
  refresh();
});
els.snap.addEventListener('click', () => {
  state.cuts.forEach((cut) => {
    cut.frame = nearestPeakFrame(cut.frame);
  });
  refresh();
});

els.audioBtn.addEventListener('click', async () => {
  els.audioReport.className = 'audio-report';
  els.audioReport.textContent = '离线渲染 12 秒混音中…';
  const report = await renderOffline(state.cuts);
  const lines = [];
  lines.push(`渲染时长 ${report.durationS.toFixed(2)}s`);
  lines.push(`静音空洞数量：${report.silentGapCount}（20ms 窗口，阈值 -60dBFS）`);
  lines.push(`全局最低 RMS：${report.minRmsDb.toFixed(1)}dBFS @ ${report.minRmsAt.toFixed(2)}s`);
  lines.push('');
  report.aroundCuts.forEach((cut, index) => {
    lines.push(`切点${index + 1} ${cut.mode} 前/处/后：` +
      `${cut.beforeDb.toFixed(1)} / ${cut.atDb.toFixed(1)} / ${cut.afterDb.toFixed(1)} dB`);
  });
  els.audioReport.textContent = lines.join('\n');
  els.audioReport.className = `audio-report ${report.silentGapCount === 0 ? 'good' : 'bad'}`;
  window.__lastAudioReport = report;
});

els.exportBtn.addEventListener('click', async () => {
  pause();
  els.exportBtn.disabled = true;
  els.exportStatus.textContent = '导出中：0%';
  try {
    const result = await exportWebM(state.cuts, {
      onProgress: (ratio) => {
        els.exportStatus.textContent = `导出中：${Math.round(ratio * 100)}%`;
      },
    });
    const url = URL.createObjectURL(result.blob);
    const sizeKb = (result.blob.size / 1024).toFixed(1);
    els.exportStatus.innerHTML =
      `<a href="${url}" download="cut-12s.webm">下载 cut-12s.webm</a>` +
      ` · ${result.mimeType} · ${sizeKb} KB`;
    window.__lastExport = { url, blob: result.blob, ...result };
  } catch (error) {
    els.exportStatus.textContent = `导出失败：${error.message}`;
    throw error;
  } finally {
    els.exportBtn.disabled = false;
  }
});

window.addEventListener('resize', () => {
  timeline.resize();
  timeline.draw();
});

// Hooks for automated verification.
window.__editor = {
  state,
  refresh,
  setFrame(frame) {
    pause();
    state.currentFrame = Math.max(0, Math.min(TOTAL_FRAMES - 1, frame));
    refresh();
  },
  moveCut(index, frame) {
    state.cuts[index].frame = Math.max(1, Math.min(TOTAL_FRAMES - 1, frame));
    refresh();
  },
  toggleMode(index) {
    toggleCutMode(index);
  },
  validate: () => validateCuts(state.cuts),
  distance: (index) => frameDistanceToPeak(state.cuts[index].frame),
  weightsAt: (timeS) => shotWeights(timeS, state.cuts),
};

refresh();
