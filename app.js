"use strict";

const DURATION_S = 20;
const FRAME_DT_S = 1 / 60;
const SCHED_LOOKAHEAD_S = 0.15;
const SCHED_INTERVAL_MS = 25;
const MAX_USER_DELAY_MS = 300;
const STORAGE_DELAY_KEY = "avsync.userDelayMs";
const STORAGE_CALIB_KEY = "avsync.calibrationMs";

const FLASH_TIMES_S = Array.from({ length: 8 }, (_, i) => 0.25 + i * 2.5);

const state = {
  position: 0,
  playing: false,
  playWallMs: 0,
  playStartPosition: 0,
  playAudioOriginCtxS: 0,
  userDelayMs: loadNumber(STORAGE_DELAY_KEY, 0),
  calibrationMs: loadNumber(STORAGE_CALIB_KEY, 0),
  scheduled: new Set(),
  playEpoch: 0,
  activeSources: [],
  shownFlashIdx: -1,
  shownBeatIdx: -1,
  lastFlashTransportS: null,
  lastBeatTransportS: null,
  deltaMs: null,
  scheduledBeats: [],
  isScrubbing: false,
};

let audioCtx = null;
let schedulerTimer = null;

function loadNumber(key, fallback) {
  const raw = localStorage.getItem(key);
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function effectiveDelayMs() {
  return clamp(state.userDelayMs - state.calibrationMs, 0, MAX_USER_DELAY_MS * 2);
}

function getPosition() {
  if (!state.playing) return state.position;
  const elapsed = (performance.now() - state.playWallMs) / 1000;
  return clamp(state.playStartPosition + elapsed, 0, DURATION_S);
}

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function stopAllAudio() {
  state.scheduled.clear();
  for (const source of state.activeSources) {
    try { source.stop(); } catch { /* already stopped */ }
  }
  state.activeSources = [];
}

function play() {
  if (state.playing) return;
  if (state.position >= DURATION_S - FRAME_DT_S) seekTo(0, true);
  const ctx = ensureAudioContext();
  stopAllAudio();
  state.playEpoch += 1;
  state.playing = true;
  state.playWallMs = performance.now();
  state.playStartPosition = state.position;
  state.playAudioOriginCtxS = ctx.currentTime;
  startScheduler();
  render();
}

function pause() {
  if (!state.playing) return;
  state.position = getPosition();
  state.playing = false;
  stopAllAudio();
  stopScheduler();
  render();
}

function seekTo(seconds, fromInternal = false) {
  const next = clamp(Number(seconds) || 0, 0, DURATION_S);
  state.position = next;
  state.scheduledBeats = [];
  stopAllAudio();
  state.shownFlashIdx = -1;
  state.shownBeatIdx = -1;
  state.lastFlashTransportS = null;
  state.lastBeatTransportS = null;
  state.deltaMs = null;
  if (state.playing) {
    const ctx = ensureAudioContext();
    state.playEpoch += 1;
    state.playWallMs = performance.now();
    state.playStartPosition = next;
    state.playAudioOriginCtxS = ctx.currentTime;
    startScheduler();
  }
  if (!fromInternal) render();
}

function stepFrame(direction) {
  const wasPlaying = state.playing;
  if (wasPlaying) pause();
  seekTo(state.position + direction * FRAME_DT_S);
}

function startScheduler() {
  if (schedulerTimer !== null) return;
  schedulerTimer = window.setInterval(scheduleDueEvents, SCHED_INTERVAL_MS);
  scheduleDueEvents();
}

function stopScheduler() {
  if (schedulerTimer === null) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
}

function scheduleDueEvents() {
  if (!state.playing) return;
  const ctx = ensureAudioContext();
  const position = getPosition();
  const horizon = Math.min(position + SCHED_LOOKAHEAD_S, DURATION_S);
  const delayS = effectiveDelayMs() / 1000;

  for (let i = 0; i < FLASH_TIMES_S.length; i += 1) {
    const eventS = FLASH_TIMES_S[i];
    if (eventS < state.playStartPosition - 1e-6 || eventS > horizon) continue;
    if (state.scheduled.has(i)) continue;
    state.scheduled.add(i);

    const beatTransportS = eventS + delayS;
    if (beatTransportS > DURATION_S) continue;
    const whenCtxS = state.playAudioOriginCtxS
      + (beatTransportS - state.playStartPosition);
    if (whenCtxS < ctx.currentTime + 0.001) continue;

    const source = createBeep(ctx, whenCtxS);
    state.activeSources.push(source);
    state.scheduledBeats.push({
      index: i,
      transportS: beatTransportS,
      epoch: state.playEpoch,
    });
    source.onended = () => {
      state.activeSources = state.activeSources.filter((s) => s !== source);
    };
  }
}

function createBeep(ctx, whenCtxS) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0, whenCtxS);
  gain.gain.linearRampToValueAtTime(0.6, whenCtxS + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.001, whenCtxS + 0.12);
  osc.connect(gain).connect(ctx.destination);
  osc.start(whenCtxS);
  osc.stop(whenCtxS + 0.14);
  return osc;
}

function frame() {
  const position = getPosition();

  if (state.playing && position >= DURATION_S) {
    state.position = DURATION_S;
    state.playing = false;
    stopAllAudio();
    stopScheduler();
  }

  updateVisuals(position);
  updateClockUi(position);
  requestAnimationFrame(frame);
}

function updateVisuals(position) {
  let flashIdx = -1;
  for (let i = 0; i < FLASH_TIMES_S.length; i += 1) {
    if (FLASH_TIMES_S[i] <= position + 1e-6) flashIdx = i;
    else break;
  }
  if (flashIdx !== state.shownFlashIdx && flashIdx >= 0) {
    state.shownFlashIdx = flashIdx;
    state.lastFlashTransportS = FLASH_TIMES_S[flashIdx];
    recomputeDelta();
  }

  let beatIdx = -1;
  for (const beat of state.scheduledBeats) {
    if (beat.epoch !== state.playEpoch) continue;
    if (beat.transportS <= position + 1e-6) beatIdx = beat.index;
  }
  if (beatIdx >= 0 && beatIdx !== state.shownBeatIdx) {
    state.shownBeatIdx = beatIdx;
    const beat = state.scheduledBeats.find((b) => b.index === beatIdx);
    if (beat) {
      state.lastBeatTransportS = beat.transportS;
      recomputeDelta();
    }
  }

  const lampOn = flashIdx >= 0
    && position - FLASH_TIMES_S[flashIdx] <= 0.18;
  document.getElementById("flashLamp").classList.toggle("on", lampOn);

  const dots = document.querySelectorAll("#flashDots li");
  dots.forEach((dot, i) => {
    dot.classList.toggle("flash", i <= flashIdx);
    dot.classList.toggle("beat", i <= beatIdx);
  });
}

function recomputeDelta() {
  if (state.lastFlashTransportS === null
    || state.lastBeatTransportS === null
    || state.shownFlashIdx !== state.shownBeatIdx) return;
  state.deltaMs = (state.lastBeatTransportS - state.lastFlashTransportS) * 1000;
}

function updateClockUi(position) {
  document.getElementById("clockPos").textContent = `${position.toFixed(3)} s`;
  if (!state.isScrubbing) {
    const slider = document.getElementById("seekSlider");
    slider.value = position.toFixed(3);
    document.getElementById("seekLabel").textContent = `${position.toFixed(3)} s`;
  }
  document.getElementById("lastFlash").textContent =
    state.lastFlashTransportS === null ? "—"
      : `#${state.shownFlashIdx + 1} @ ${state.lastFlashTransportS.toFixed(3)}s`;
  document.getElementById("lastBeat").textContent =
    state.lastBeatTransportS === null ? "—"
      : `#${state.shownBeatIdx + 1} @ ${state.lastBeatTransportS.toFixed(3)}s`;

  const deltaEl = document.getElementById("deltaValue");
  if (state.deltaMs === null) {
    deltaEl.textContent = "—";
    deltaEl.classList.remove("positive", "negative");
  } else {
    const rounded = Math.round(state.deltaMs);
    deltaEl.textContent = `${rounded > 0 ? "+" : ""}${rounded} ms`;
    deltaEl.classList.toggle("positive", rounded > 0);
    deltaEl.classList.toggle("negative", rounded < 0);
  }
  document.getElementById("calibValue").textContent = `${state.calibrationMs} ms`;
  document.getElementById("effectiveValue").textContent = `${effectiveDelayMs()} ms`;
  document.getElementById("playBtn").disabled = state.playing;
}

function render() {
  updateVisuals(getPosition());
  updateClockUi(getPosition());
}

function saveCalibration() {
  if (state.deltaMs === null) {
    setStatus("请先播放，让闪光与节拍各触发一次后再校正。");
    return;
  }
  state.calibrationMs = clamp(
    state.calibrationMs + Math.round(state.deltaMs),
    -MAX_USER_DELAY_MS,
    MAX_USER_DELAY_MS,
  );
  localStorage.setItem(STORAGE_CALIB_KEY, String(state.calibrationMs));
  setStatus(`已保存校正偏移 ${state.calibrationMs} ms，刷新页面后自动恢复。`);
  render();
}

function clearCalibration() {
  state.calibrationMs = 0;
  localStorage.removeItem(STORAGE_CALIB_KEY);
  setStatus("已清除校正偏移。");
  render();
}

function setStatus(text) {
  document.getElementById("statusLine").textContent = text;
}

function bindUi() {
  const dots = document.getElementById("flashDots");
  FLASH_TIMES_S.forEach((t, i) => {
    const li = document.createElement("li");
    li.title = `#${i + 1} @ ${t.toFixed(2)}s`;
    dots.appendChild(li);
  });

  const delaySlider = document.getElementById("delaySlider");
  const delayLabel = document.getElementById("delayLabel");
  delaySlider.value = String(state.userDelayMs);
  delayLabel.textContent = `${state.userDelayMs} ms`;
  delaySlider.addEventListener("input", () => {
    state.userDelayMs = Number(delaySlider.value);
    localStorage.setItem(STORAGE_DELAY_KEY, String(state.userDelayMs));
    delayLabel.textContent = `${state.userDelayMs} ms`;
    render();
  });

  const seekSlider = document.getElementById("seekSlider");
  seekSlider.addEventListener("pointerdown", () => { state.isScrubbing = true; });
  seekSlider.addEventListener("input", () => {
    document.getElementById("seekLabel").textContent = `${Number(seekSlider.value).toFixed(3)} s`;
    seekTo(Number(seekSlider.value));
  });
  seekSlider.addEventListener("pointerup", () => { state.isScrubbing = false; render(); });
  seekSlider.addEventListener("change", () => { state.isScrubbing = false; render(); });

  document.getElementById("playBtn").addEventListener("click", play);
  document.getElementById("pauseBtn").addEventListener("click", pause);
  document.getElementById("stepBackBtn").addEventListener("click", () => stepFrame(-1));
  document.getElementById("stepFwdBtn").addEventListener("click", () => stepFrame(1));
  document.getElementById("restartBtn").addEventListener("click", () => seekTo(0));
  document.getElementById("calibrateBtn").addEventListener("click", saveCalibration);
  document.getElementById("clearCalibBtn").addEventListener("click", clearCalibration);

  window.addEventListener("beforeunload", stopAllAudio);
}

bindUi();
requestAnimationFrame(frame);
render();

window.avSync = {
  state,
  play,
  pause,
  seekTo,
  stepFrame,
  saveCalibration,
  clearCalibration,
  getPosition,
  effectiveDelayMs,
  flashTimes: FLASH_TIMES_S,
};
