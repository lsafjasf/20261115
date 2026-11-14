import {
  CANVAS,
  DEFAULT_CONFIG,
  SAMPLE_CREDITS,
  buildCues,
  buildTimeline,
  buildTrackModel,
  buildWebVTT,
  createGeometry,
  currentRowState,
  formatDuration,
  formatTimecode,
  getFadeAmount,
  parseCredits,
  scrollAtTime,
  slowFactorAtScroll,
  validateLayout,
} from "./timeline.js";
import {
  drawBackdropFade,
  drawCredits,
  drawScene,
  drawSafeFrame,
} from "./scene.js";

const $ = (selector) => document.querySelector(selector);
const canvas = $("#stageCanvas");
const context = canvas.getContext("2d");
const fontFamily = '"RC Serif", "Noto Serif CJK SC", "Songti SC", "STSong", serif';

const elements = {
  credits: $("#creditsInput"),
  gutter: $("#editorGutter"),
  lineBadge: $("#lineBadge"),
  textStats: $("#textStats"),
  speed: $("#speedInput"),
  speedValue: $("#speedValue"),
  hold: $("#holdInput"),
  holdValue: $("#holdValue"),
  fade: $("#fadeInput"),
  fadeValue: $("#fadeValue"),
  fadeToggle: $("#fadeToggle"),
  volume: $("#volumeInput"),
  audioButton: $("#audioButton"),
  soundButton: $("#soundButton"),
  play: $("#playButton"),
  loop: $("#loopButton"),
  timeline: $("#timelineInput"),
  currentTime: $("#currentTime"),
  durationTime: $("#durationTime"),
  metricDuration: $("#metricDuration"),
  metricFrames: $("#metricFrames"),
  metricDistance: $("#metricDistance"),
  metricRows: $("#metricRows"),
  metricSlow: $("#metricSlow"),
  metricSlowState: $("#metricSlowState"),
  metricCheck: $("#metricCheck"),
  metricCheckNote: $("#metricCheckNote"),
  boundaryMetric: $("#boundaryMetric"),
  slowGauge: $("#slowGaugeFill"),
  sceneState: $("#sceneState"),
  stage: $("#stageFrame"),
  toast: $("#toast"),
  reset: $("#resetButton"),
  png: $("#pngButton"),
  vtt: $("#vttButton"),
  vttTop: $("#vttTopButton"),
  fullscreen: $("#fullscreenButton"),
};

const state = {
  playhead: 0,
  playing: false,
  loop: true,
  soundEnabled: true,
  volume: 0.46,
  model: null,
  geometry: null,
  timeline: null,
  cues: [],
  validation: null,
  config: {
    ...DEFAULT_CONFIG,
    speed: Number(elements.speed.value),
    hold: Number(elements.hold.value),
    fadeEnabled: elements.fadeToggle.checked,
    fadeStart: Number(elements.fade.value) / 100,
    fontSize: 38,
    lineHeight: 74,
  },
};

let animationFrame = 0;
let lastFrameTime = 0;
let rebuildFrame = 0;
let toastTimer = 0;

function setRangeProgress(element, percent) {
  element.style.setProperty("--range-progress", `${Math.min(100, Math.max(0, percent))}%`);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2400);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

class AmbientAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.padGain = null;
    this.noiseGain = null;
    this.started = false;
    this.enabled = true;
    this.playing = false;
    this.volume = 0.46;
  }

  ensure() {
    if (this.context) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);

    this.padGain = this.context.createGain();
    this.padGain.gain.value = 0.11;
    this.padGain.connect(this.master);

    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 740;
    filter.Q.value = 0.7;
    filter.connect(this.padGain);

    [55, 82.5, 110, 164.8].forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = index === 2 ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index * 3 - 4;
      gain.gain.value = index === 0 ? 0.5 : index === 1 ? 0.29 : 0.12;
      oscillator.connect(gain);
      gain.connect(filter);
      oscillator.start();
    });

    const lfo = this.context.createOscillator();
    const lfoGain = this.context.createGain();
    lfo.frequency.value = 0.055;
    lfoGain.gain.value = 150;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    const noiseBuffer = this.context.createBuffer(1, this.context.sampleRate * 3, this.context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let previous = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      previous = previous * 0.984 + white * 0.016;
      data[index] = previous * 3.4;
    }

    const noise = this.context.createBufferSource();
    const noiseFilter = this.context.createBiquadFilter();
    this.noiseGain = this.context.createGain();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 540;
    this.noiseGain.gain.value = 0.16;
    noise.connect(noiseFilter);
    noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.master);
    noise.start();
    this.started = true;
  }

  updateGain(immediate = false) {
    if (!this.context || !this.master) return;
    const level = this.enabled && this.playing ? this.volume * 0.52 : 0;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(level, now, immediate ? 0.01 : 0.22);
  }

  setPlaying(playing) {
    this.playing = playing;
    if (playing) {
      this.ensure();
      if (this.context?.state === "suspended") this.context.resume();
    }
    this.updateGain();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.updateGain();
  }

  setVolume(volume) {
    this.volume = volume;
    this.updateGain();
  }
}

const audio = new AmbientAudio();

function measureText(text) {
  context.font = `400 ${state.config.fontSize}px ${fontFamily}`;
  return context.measureText(text).width;
}

function updateGutter() {
  const sourceLines = parseCredits(elements.credits.value);
  elements.gutter.innerHTML = sourceLines
    .map(
      (line, index) =>
        `<span class="${line.blank ? "breathe" : ""}">${line.blank ? "·" : String(index + 1).padStart(2, "0")}</span>`
    )
    .join("");
  elements.gutter.scrollTop = elements.credits.scrollTop;
}

function rebuild() {
  const config = state.config;
  const model = buildTrackModel(elements.credits.value, measureText, config);
  const geometry = createGeometry(model, config);
  const timeline = buildTimeline(geometry, config);
  const cues = buildCues(model, geometry, timeline);
  const validation = validateLayout(model, geometry, timeline, config, cues.length);

  state.model = model;
  state.geometry = geometry;
  state.timeline = timeline;
  state.cues = cues;
  state.validation = validation;
  state.playhead = Math.min(state.playhead, timeline.duration);

  updateGutter();
  updateEditorStats();
  updateMetrics();
  renderFrame();
  updateTransport();
}

function updateEditorStats() {
  const model = state.model;
  const lineLabel = `${model.lineCount} 行`;
  elements.lineBadge.textContent = lineLabel;
  elements.textStats.textContent = `${model.lineCount} 行字幕 · ${model.blankCount} 处留白`;
}

function updateMetrics() {
  const { model, geometry, timeline, validation, config } = state;
  elements.durationTime.textContent = formatTimecode(timeline.duration);
  elements.metricDuration.textContent = formatTimecode(timeline.duration);
  elements.metricFrames.textContent = `${Math.round(timeline.duration * CANVAS.fps)} 帧 · ${CANVAS.fps} FPS`;
  elements.metricDistance.textContent = `${Math.round(geometry.maxScroll)} px`;
  elements.metricRows.textContent = `${model.lineCount} 行字幕 / ${model.rows.length} 视觉行`;
  elements.fadeValue.textContent = `${Math.round(config.fadeStart * 100)}%`;
  elements.speedValue.textContent = `${Math.round(config.speed)} px/s`;
  elements.holdValue.textContent = `${config.hold.toFixed(1)} s`;

  elements.boundaryMetric.classList.toggle("unsafe", !validation.safe);
  elements.metricCheck.textContent = validation.safe ? "边界安全" : "需要检查";
  elements.metricCheckNote.textContent = validation.safe
    ? `${validation.lineCount} / ${validation.checkedLineCount} 行未裁切`
    : validation.horizontalSafe
      ? "请检查滚动边界"
      : "存在超宽文本";
  elements.metricCheck.parentElement.querySelector(".check-icon").textContent = validation.safe ? "✓" : "!";
}

function updateTransport() {
  const { timeline, playhead } = state;
  const progress = timeline.duration ? playhead / timeline.duration : 0;
  const tenths = Math.round(progress * 1000);
  elements.timeline.value = String(tenths);
  setRangeProgress(elements.timeline, progress * 100);
  elements.currentTime.textContent = formatTimecode(playhead);
  elements.play.setAttribute("aria-pressed", String(state.playing));
  elements.play.setAttribute("aria-label", state.playing ? "暂停预览" : "播放预览");
  elements.stage.classList.toggle("is-playing", state.playing);
  elements.stage.classList.toggle("is-paused", !state.playing);
  elements.sceneState.textContent = `${state.playing ? "PLAYING" : "STILL"} / ${formatTimecode(playhead)}`;
  elements.loop.classList.toggle("active", state.loop);
  elements.loop.setAttribute("aria-pressed", String(state.loop));
  updateSlowReadout();
}

function updateSlowReadout() {
  const { geometry, timeline, playhead } = state;
  const scroll = scrollAtTime(timeline, playhead);
  const factor = slowFactorAtScroll(geometry, scroll, state.config);
  const rowState = currentRowState(geometry, scroll);
  const slowed = factor < 0.995;
  elements.metricSlow.textContent = `${factor.toFixed(2)}×`;
  elements.metricSlowState.textContent = slowed
    ? `${rowState.onBlank ? "留白区" : "减速缓冲"} · 自动减速`
    : "焦点区 · 正常速度";
  elements.metricSlow.style.color = slowed ? "var(--mint)" : "";
  elements.slowGauge.style.transform = `scaleX(${factor.toFixed(3)})`;
}

function renderFrame() {
  if (!state.geometry) return;
  const fade = getFadeAmount(state.playhead, state.timeline.duration, state.config);
  const scroll = scrollAtTime(state.timeline, state.playhead);

  context.clearRect(0, 0, CANVAS.width, CANVAS.height);
  drawScene(context, state.playhead);
  drawBackdropFade(context, fade);
  drawCredits(context, state.geometry, scroll, state.config);
  drawSafeFrame(context, false);
}

function scheduleRebuild() {
  window.cancelAnimationFrame(rebuildFrame);
  rebuildFrame = window.requestAnimationFrame(rebuild);
}

function playbackLoop(timestamp) {
  if (!state.playing) return;
  if (!lastFrameTime) lastFrameTime = timestamp;
  const delta = Math.min(0.1, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;
  state.playhead += delta;

  if (state.playhead >= state.timeline.duration) {
    if (state.loop && state.timeline.duration > 0) {
      state.playhead %= state.timeline.duration;
    } else {
      state.playhead = state.timeline.duration;
      setPlaying(false);
      return;
    }
  }

  renderFrame();
  updateTransport();
  animationFrame = window.requestAnimationFrame(playbackLoop);
}

function setPlaying(playing) {
  if (playing && state.playhead >= state.timeline.duration - 0.001) state.playhead = 0;
  state.playing = Boolean(playing && state.timeline.duration > 0);
  lastFrameTime = 0;
  window.cancelAnimationFrame(animationFrame);
  audio.setPlaying(state.playing);

  if (state.playing) {
    animationFrame = window.requestAnimationFrame(playbackLoop);
  } else {
    renderFrame();
  }
  updateTransport();
}

function setSoundEnabled(enabled) {
  state.soundEnabled = enabled;
  audio.setEnabled(enabled);
  [elements.audioButton, elements.soundButton].forEach((button) => {
    button.setAttribute("aria-pressed", String(enabled));
  });
  showToast(enabled ? "背景音已开启" : "背景音已静音");
}

function seek(time, announce = false) {
  const duration = state.timeline.duration;
  state.playhead = Math.max(0, Math.min(duration, Number(time) || 0));
  lastFrameTime = 0;
  renderFrame();
  updateTransport();
  if (announce) elements.sceneState.textContent = `STILL / ${formatTimecode(state.playhead)}`;
}

function exportVTT() {
  if (!state.cues.length) {
    showToast("没有可导出的字幕内容");
    return;
  }
  const vtt = buildWebVTT(state.cues, state.timeline.duration);
  download(new Blob([vtt], { type: "text/vtt;charset=utf-8" }), "night-flight-end-credits.vtt");
  showToast(`已导出 WebVTT · ${state.cues.length} 个分段`);
}

async function exportPNG() {
  if (document.fonts?.ready) await document.fonts.ready;
  renderFrame();
  canvas.toBlob((blob) => {
    if (!blob) {
      showToast("PNG 导出失败，请重试");
      return;
    }
    const stamp = formatTimecode(state.playhead).replace(":", "-").replace(".", "-");
    download(blob, `night-flight-layout-${stamp}.png`);
    showToast("已导出当前帧 PNG · 1280 × 720");
  }, "image/png");
}

function updateRangeState(input, output, value, unit, digits = 0) {
  const min = Number(input.min);
  const max = Number(input.max);
  const progress = ((value - min) / (max - min)) * 100;
  setRangeProgress(input, progress);
  output.textContent = `${value.toFixed(digits)} ${unit}`;
}

elements.credits.addEventListener("input", () => {
  updateGutter();
  scheduleRebuild();
});
elements.credits.addEventListener("scroll", () => {
  elements.gutter.scrollTop = elements.credits.scrollTop;
});

elements.speed.addEventListener("input", () => {
  state.config.speed = Number(elements.speed.value);
  updateRangeState(elements.speed, elements.speedValue, state.config.speed, "px/s");
  scheduleRebuild();
});

elements.hold.addEventListener("input", () => {
  state.config.hold = Number(elements.hold.value);
  updateRangeState(elements.hold, elements.holdValue, state.config.hold, "s", 1);
  scheduleRebuild();
});

elements.fade.addEventListener("input", () => {
  state.config.fadeStart = Number(elements.fade.value) / 100;
  const progress = ((Number(elements.fade.value) - 55) / 40) * 100;
  setRangeProgress(elements.fade, progress);
  elements.fadeValue.textContent = `${elements.fade.value}%`;
  renderFrame();
});

elements.fadeToggle.addEventListener("change", () => {
  state.config.fadeEnabled = elements.fadeToggle.checked;
  renderFrame();
});

elements.volume.addEventListener("input", () => {
  const value = Number(elements.volume.value);
  state.volume = value / 100;
  audio.setVolume(state.volume);
  setRangeProgress(elements.volume, value);
});

elements.play.addEventListener("click", () => setPlaying(!state.playing));
elements.stage.addEventListener("click", () => setPlaying(!state.playing));

elements.timeline.addEventListener("input", () => {
  const progress = Number(elements.timeline.value) / 1000;
  seek(state.timeline.duration * progress);
  setRangeProgress(elements.timeline, progress * 100);
});

elements.loop.addEventListener("click", () => {
  state.loop = !state.loop;
  updateTransport();
  showToast(state.loop ? "循环播放已开启" : "循环播放已关闭");
});

[elements.audioButton, elements.soundButton].forEach((button) => {
  button.addEventListener("click", () => setSoundEnabled(!state.soundEnabled));
});

elements.reset.addEventListener("click", () => {
  elements.credits.value = SAMPLE_CREDITS;
  state.playhead = 0;
  rebuild();
  showToast("已恢复十行示例字幕");
});

[elements.vtt, elements.vttTop].forEach((button) => button.addEventListener("click", exportVTT));
elements.png.addEventListener("click", exportPNG);

elements.fullscreen.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await elements.stage.requestFullscreen();
  } catch {
    showToast("当前浏览器不支持全屏预览");
  }
});

document.addEventListener("keydown", (event) => {
  const tag = event.target.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return;
  if (event.code === "Space") {
    event.preventDefault();
    setPlaying(!state.playing);
  }
  if (event.key === "ArrowLeft") seek(state.playhead - 2);
  if (event.key === "ArrowRight") seek(state.playhead + 2);
});

function initialize() {
  elements.credits.value = SAMPLE_CREDITS;
  setRangeProgress(elements.speed, ((Number(elements.speed.value) - 24) / 86) * 100);
  setRangeProgress(elements.hold, (Number(elements.hold.value) / 2.4) * 100);
  setRangeProgress(elements.fade, ((Number(elements.fade.value) - 55) / 40) * 100);
  setRangeProgress(elements.volume, Number(elements.volume.value));
  audio.setVolume(state.volume);
  audio.setEnabled(true);
  elements.stage.classList.add("is-paused");
  elements.durationTime.textContent = "00:00.0";
  rebuild();
}

window.__creditsLab = {
  seek,
  play: () => setPlaying(true),
  pause: () => setPlaying(false),
  snapshot() {
    const scroll = scrollAtTime(state.timeline, state.playhead);
    return {
      playhead: state.playhead,
      playing: state.playing,
      duration: state.timeline.duration,
      scroll,
      maxScroll: state.geometry.maxScroll,
      fade: getFadeAmount(state.playhead, state.timeline.duration, state.config),
      slowFactor: slowFactorAtScroll(state.geometry, scroll, state.config),
      lineCount: state.model.lineCount,
      rowCount: state.model.rows.length,
      blankCount: state.model.blankCount,
      cueCount: state.cues.length,
      cues: state.cues,
      validation: state.validation,
      vtt: buildWebVTT(state.cues, state.timeline.duration),
      audio: {
        contextState: audio.context?.state ?? "not-created",
        started: audio.started,
        playing: audio.playing,
        enabled: audio.enabled,
        volume: audio.volume,
      },
    };
  },
};

initialize();
if (document.fonts?.ready) {
  document.fonts.ready.then(() => rebuild()).catch(() => {});
}
