import { buildBeatTrack, getAccentEnergy } from "./audio.js";
import { drawScene, getSceneDebug } from "./scene.js";
import { ArrayBufferTarget, Muxer } from "../vendor/webm-muxer.mjs";
import {
  ALL_AUDIO_EVENTS,
  AUDIO_EVENTS,
  BEAT_EVENTS,
  FLASHES,
  MAX_OFFSET_FRAMES,
  PROJECT,
  TOTAL_FRAMES,
  clampOffsetFrames,
  formatOffset,
  formatTime,
  offsetFramesToMs,
  offsetFramesToSec,
  projectStateHash,
} from "./project.js";

const STORAGE_KEY = "eight-flash-sync-project-v1";
const MIN_SAVE_GAP_MS = 180;

const elements = {
  canvas: document.querySelector("#preview"),
  frameNumber: document.querySelector("#frameNumber"),
  canvasOffsetValue: document.querySelector("#canvasOffsetValue"),
  canvasOffsetDirection: document.querySelector("#canvasOffsetDirection"),
  currentTimecode: document.querySelector("#currentTimecode"),
  playButton: document.querySelector("#playButton"),
  playIcon: document.querySelector("#playIcon"),
  playLabel: document.querySelector("#playLabel"),
  toStartButton: document.querySelector("#toStartButton"),
  toEndButton: document.querySelector("#toEndButton"),
  jsonButton: document.querySelector("#jsonButton"),
  exportButton: document.querySelector("#exportButton"),
  exportOverlay: document.querySelector("#exportOverlay"),
  exportPercent: document.querySelector("#exportPercent"),
  offsetSign: document.querySelector("#offsetSign"),
  offsetMs: document.querySelector("#offsetMs"),
  offsetFramesLabel: document.querySelector("#offsetFramesLabel"),
  offsetDirection: document.querySelector("#offsetDirection"),
  offsetFill: document.querySelector("#offsetFill"),
  offsetHandle: document.querySelector("#offsetHandle"),
  nudgeBack: document.querySelector("#nudgeBack"),
  nudgeForward: document.querySelector("#nudgeForward"),
  resetOffsetButton: document.querySelector("#resetOffsetButton"),
  nextAccentCountdown: document.querySelector("#nextAccentCountdown"),
  nextEventNumber: document.querySelector("#nextEventNumber"),
  nextEventName: document.querySelector("#nextEventName"),
  nextEventTime: document.querySelector("#nextEventTime"),
  timeline: document.querySelector("#timeline"),
  ruler: document.querySelector("#ruler"),
  beatLane: document.querySelector("#beatLane"),
  audioLane: document.querySelector("#audioLane"),
  visualLane: document.querySelector("#visualLane"),
  playhead: document.querySelector("#playhead"),
  nowEvent: document.querySelector("#nowEvent"),
  eventList: document.querySelector("#eventList"),
  manifestFrames: document.querySelector("#manifestFrames"),
  manifestMs: document.querySelector("#manifestMs"),
  manifestHash: document.querySelector("#manifestHash"),
  saveStatus: document.querySelector("#saveStatus"),
  saveStatusText: document.querySelector("#saveStatusText"),
  reloadProjectButton: document.querySelector("#reloadProjectButton"),
  toast: document.querySelector("#toast"),
};

const context = elements.canvas.getContext("2d", { alpha: false });

const state = {
  offsetFrames: 0,
  currentTime: 0,
  isPlaying: false,
  audioContext: null,
  audioBuffer: null,
  masterGain: null,
  source: null,
  playStartCtxTime: 0,
  playStartMediaTime: 0,
  animationFrame: 0,
  exporting: false,
  exportProgress: 0,
  lastExport: null,
  lastExportBlob: null,
  lastSceneDebug: getSceneDebug(0),
  savedAt: null,
  saveTimer: 0,
  toastTimer: 0,
};

let dragState = null;
let lastInteractionSave = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function videoTimeFor(audioTime) {
  return clamp(
    audioTime - offsetFramesToSec(state.offsetFrames),
    0,
    PROJECT.durationSec,
  );
}

function currentFrameFor(audioTime) {
  const sourceTime = videoTimeFor(audioTime);
  return clamp(
    Math.floor(sourceTime * PROJECT.fps + 1e-7),
    0,
    TOTAL_FRAMES - 1,
  );
}

function sceneStateAt(audioTime) {
  return getSceneDebug(videoTimeFor(audioTime));
}

function getCurrentPlaybackTime() {
  if (!state.isPlaying || !state.audioContext) return state.currentTime;
  const elapsed = Math.max(
    0,
    state.audioContext.currentTime - state.playStartCtxTime,
  );
  return clamp(
    state.playStartMediaTime + elapsed,
    0,
    PROJECT.durationSec,
  );
}

function renderAt(audioTime) {
  state.lastSceneDebug = drawScene(context, videoTimeFor(audioTime));
}

function drawTransport(time) {
  renderAt(time);
  updateInterface(time);
}

function positionPercent(time) {
  return clamp((time / PROJECT.durationSec) * 100, 0, 100);
}

function getTimelineGeometry() {
  const rect = elements.timeline.getBoundingClientRect();
  const paddingLeft = parseFloat(getComputedStyle(elements.timeline).paddingLeft) || 0;
  return {
    startX: rect.left + paddingLeft,
    width: Math.max(1, rect.width - paddingLeft),
  };
}

function getLatestAudioEvent(time) {
  let chosen = ALL_AUDIO_EVENTS[0];
  for (const event of ALL_AUDIO_EVENTS) {
    if (event.timeSec > time + 0.0005) break;
    if (
      Math.abs(event.timeSec - chosen.timeSec) < 0.0005 &&
      event.kind === "accent"
    ) {
      chosen = event;
    } else {
      chosen = event;
    }
  }
  return chosen;
}

function getNextAccent(time) {
  return AUDIO_EVENTS.find((event) => event.timeSec >= time - 0.0004) || null;
}

function updateTimelineOffset() {
  const markerSet = elements.visualLane.querySelectorAll(".visual-marker");
  markerSet.forEach((marker, index) => {
    const flash = FLASHES[index];
    const shiftedTime = flash.timeSec + offsetFramesToSec(state.offsetFrames);
    marker.style.left = `${positionPercent(shiftedTime)}%`;
    marker.title = `FLASH ${String(index + 1).padStart(2, "0")} · 视觉 ${formatTime(flash.timeSec)} · 实际 ${formatTime(shiftedTime)}`;
  });
}

function updateInterface(time = state.currentTime) {
  const safeTime = clamp(time, 0, PROJECT.durationSec);
  const frame = currentFrameFor(safeTime);
  const latestEvent = getLatestAudioEvent(safeTime);
  const nextAccent = getNextAccent(safeTime);
  const offsetMs = offsetFramesToMs(state.offsetFrames);
  const absoluteFrames = Math.abs(state.offsetFrames);
  const playheadPercent = positionPercent(safeTime);

  elements.frameNumber.textContent = String(frame).padStart(4, "0");
  elements.currentTimecode.textContent = formatTime(safeTime);
  elements.canvasOffsetValue.textContent = `${formatOffset(state.offsetFrames)} ms`;
  elements.canvasOffsetDirection.textContent =
    state.offsetFrames === 0
      ? "音画同步"
      : state.offsetFrames > 0
        ? "视频延后"
        : "视频提前";
  elements.offsetSign.textContent =
    state.offsetFrames === 0 ? "" : state.offsetFrames > 0 ? "+" : "−";
  elements.offsetMs.textContent = String(Math.round(Math.abs(offsetMs) * 10) / 10);
  elements.offsetFramesLabel.textContent = `${absoluteFrames} 帧`;
  elements.offsetDirection.textContent =
    state.offsetFrames === 0
      ? "音画同步"
      : state.offsetFrames > 0
        ? "视频延后 · 闪烁更晚"
        : "视频提前 · 闪烁更早";

  const handlePercent = 50 + (state.offsetFrames / MAX_OFFSET_FRAMES) * 50;
  elements.offsetHandle.style.left = `${handlePercent}%`;
  elements.offsetFill.style.left = `${Math.min(50, handlePercent)}%`;
  elements.offsetFill.style.width = `${Math.abs(handlePercent - 50)}%`;
  elements.nudgeBack.disabled = state.exporting || state.offsetFrames <= -MAX_OFFSET_FRAMES;
  elements.nudgeForward.disabled = state.exporting || state.offsetFrames >= MAX_OFFSET_FRAMES;
  elements.playButton.disabled = state.exporting;
  elements.exportButton.disabled = state.exporting;
  elements.jsonButton.disabled = state.exporting;
  elements.toStartButton.disabled = state.exporting;
  elements.toEndButton.disabled = state.exporting;

  elements.playButton.classList.toggle("is-playing", state.isPlaying);
  elements.playIcon.classList.toggle("is-pause", state.isPlaying);
  elements.playLabel.textContent = state.isPlaying ? "暂停" : "播放";
  elements.playButton.setAttribute("aria-label", state.isPlaying ? "暂停" : "播放");

  elements.manifestFrames.textContent = `${state.offsetFrames} 帧`;
  elements.manifestMs.textContent = `${offsetMs.toFixed(3)} ms`;
  elements.manifestHash.textContent = projectStateHash(state.offsetFrames);

  elements.playhead.style.setProperty("--position", String(playheadPercent));
  const geometry = getTimelineGeometry();
  elements.playhead.style.left = `${geometry.startX - elements.timeline.getBoundingClientRect().left + (playheadPercent / 100) * geometry.width}px`;
  elements.playhead.querySelector("span").textContent = formatTime(safeTime);
  elements.timeline.setAttribute("aria-valuenow", safeTime.toFixed(3));

  const eventText =
    latestEvent.kind === "accent"
      ? `${latestEvent.label} · ${formatTime(latestEvent.timeSec)}`
      : `BEAT ${String(latestEvent.index + 1).padStart(3, "0")} · ${formatTime(latestEvent.timeSec)}`;
  elements.nowEvent.textContent = eventText;

  if (nextAccent) {
    const countdown = Math.max(0, nextAccent.timeSec - safeTime);
    elements.nextAccentCountdown.textContent =
      countdown < 0.0005 ? "NOW" : `${countdown.toFixed(3)} s`;
    elements.nextEventNumber.textContent = String(nextAccent.index + 1).padStart(2, "0");
    elements.nextEventName.textContent = `${nextAccent.label} / ACCENT`;
    elements.nextEventTime.textContent = `音频事件 ${formatTime(nextAccent.timeSec)}`;
  } else {
    elements.nextAccentCountdown.textContent = "END";
    elements.nextEventNumber.textContent = "08";
    elements.nextEventName.textContent = "FINAL PULSE / COMPLETE";
    elements.nextEventTime.textContent = "已通过最后一次重拍";
  }

  const activeIndex =
    safeTime >= AUDIO_EVENTS[0].timeSec
      ? AUDIO_EVENTS.reduce(
          (result, event, index) =>
            safeTime >= event.timeSec - 0.0004 &&
            safeTime < event.timeSec + 0.55
              ? index
              : result,
          -1,
        )
      : -1;
  elements.eventList.querySelectorAll(".event-card").forEach((card, index) => {
    card.classList.toggle("is-active", index === activeIndex);
  });
  updateTimelineOffset();
}

function buildTimeline() {
  elements.ruler.replaceChildren();
  for (let second = 0; second <= PROJECT.durationSec; second += 3) {
    const label = document.createElement("span");
    label.className = "ruler-label";
    if (second === PROJECT.durationSec) label.classList.add("is-end");
    label.style.left = `${positionPercent(second)}%`;
    const text = document.createElement("span");
    text.textContent = formatTime(second, false);
    label.append(text);
    elements.ruler.append(label);
  }

  BEAT_EVENTS.forEach((beat) => {
    const tick = document.createElement("i");
    tick.className = `beat-tick${beat.isBar ? " is-bar" : ""}`;
    tick.style.left = `${positionPercent(beat.timeSec)}%`;
    elements.beatLane.append(tick);
  });

  AUDIO_EVENTS.forEach((event) => {
    const marker = document.createElement("span");
    marker.className = "audio-marker";
    marker.style.left = `${positionPercent(event.timeSec)}%`;
    marker.title = `${event.label} · ${formatTime(event.timeSec)} · 音频重拍`;
    const dot = document.createElement("i");
    const number = document.createElement("span");
    number.textContent = String(event.index + 1).padStart(2, "0");
    marker.append(dot, number);
    elements.audioLane.append(marker);
  });

  FLASHES.forEach((flash) => {
    const marker = document.createElement("i");
    marker.className = "visual-marker";
    marker.dataset.flashIndex = String(flash.index);
    marker.style.left = `${positionPercent(flash.timeSec)}%`;
    elements.visualLane.append(marker);
  });

  elements.eventList.replaceChildren();
  AUDIO_EVENTS.forEach((event) => {
    const card = document.createElement("article");
    card.className = "event-card";
    card.dataset.eventIndex = String(event.index);

    const top = document.createElement("div");
    top.className = "event-top";
    const number = document.createElement("b");
    number.textContent = String(event.index + 1).padStart(2, "0");
    const kind = document.createElement("span");
    kind.textContent = "ACCENT";
    top.append(number, kind);

    const title = document.createElement("h3");
    title.textContent = event.label;
    const detail = document.createElement("p");
    const time = document.createElement("span");
    time.textContent = formatTime(event.timeSec);
    const visual = document.createElement("span");
    visual.textContent = `V ${String(event.frame).padStart(3, "0")}`;
    detail.append(time, visual);
    card.append(top, title, detail);
    elements.eventList.append(card);
  });

  updateTimelineOffset();
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 3200);
}

function setSaveState(saveState) {
  elements.saveStatus.dataset.state = saveState;
  elements.saveStatusText.textContent =
    saveState === "saving" ? "正在保存工程…" : "工程已自动保存";
}

function persistProject() {
  window.clearTimeout(state.saveTimer);
  const payload = {
    schema: "eight-flash/project@1",
    projectId: PROJECT.id,
    offsetFrames: state.offsetFrames,
    playheadSec: Number(state.currentTime.toFixed(6)),
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    state.savedAt = payload.savedAt;
    setSaveState("saved");
  } catch {
    elements.saveStatus.dataset.state = "saving";
    elements.saveStatusText.textContent = "浏览器未允许本地保存";
  }
}

function saveProject(immediate = false) {
  if (state.exporting) return;
  setSaveState("saving");
  const elapsed = performance.now() - lastInteractionSave;
  window.clearTimeout(state.saveTimer);
  if (immediate || elapsed >= MIN_SAVE_GAP_MS) {
    lastInteractionSave = performance.now();
    persistProject();
    return;
  }
  state.saveTimer = window.setTimeout(() => {
    lastInteractionSave = performance.now();
    persistProject();
  }, MIN_SAVE_GAP_MS - elapsed);
}

function hydrateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (saved.projectId !== PROJECT.id || !Number.isFinite(saved.offsetFrames)) {
      return false;
    }
    state.offsetFrames = clampOffsetFrames(saved.offsetFrames);
    if (Number.isFinite(saved.playheadSec)) {
      state.currentTime = clamp(saved.playheadSec, 0, PROJECT.durationSec);
    }
    state.savedAt = saved.savedAt || null;
    return true;
  } catch {
    return false;
  }
}

function reloadSavedProject() {
  pausePlayback({ save: false });
  const restored = hydrateFromStorage();
  if (!restored) {
    showToast("没有找到可载入的工程快照。");
    return;
  }
  drawTransport(state.currentTime);
  showToast(
    `已重新载入：偏移 ${formatOffset(state.offsetFrames)} ms，播放头 ${formatTime(state.currentTime)}。`,
  );
}

async function ensureAudioReady() {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio。");
    state.audioContext = new AudioContextClass({ latencyHint: "interactive" });
    state.masterGain = state.audioContext.createGain();
    state.masterGain.gain.value = 0.82;
    state.masterGain.connect(state.audioContext.destination);
    state.audioBuffer = buildBeatTrack(state.audioContext);
  }
  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }
  return state.audioContext;
}

function stopPlaybackSource() {
  if (!state.source) return;
  const source = state.source;
  state.source = null;
  source.onended = null;
  try {
    source.stop();
  } catch {
    // A source that has already ended cannot be stopped again.
  }
  source.disconnect();
}

async function startPlayback() {
  if (state.exporting) return;
  const audioContext = await ensureAudioReady();
  if (state.currentTime >= PROJECT.durationSec - 0.0005) {
    state.currentTime = 0;
  }
  stopPlaybackSource();
  cancelAnimationFrame(state.animationFrame);

  const source = audioContext.createBufferSource();
  source.buffer = state.audioBuffer;
  source.connect(state.masterGain);
  const startCtxTime = audioContext.currentTime + 0.025;
  state.source = source;
  state.playStartCtxTime = startCtxTime;
  state.playStartMediaTime = state.currentTime;
  state.isPlaying = true;
  source.onended = () => {
    if (state.source !== source) return;
    state.source = null;
    state.currentTime = PROJECT.durationSec;
    state.isPlaying = false;
    cancelAnimationFrame(state.animationFrame);
    drawTransport(PROJECT.durationSec);
    saveProject(true);
  };
  source.start(startCtxTime, state.currentTime);
  drawTransport(state.currentTime);
  state.animationFrame = requestAnimationFrame(playbackTick);
}

function playbackTick() {
  if (!state.isPlaying) return;
  const time = getCurrentPlaybackTime();
  state.currentTime = time;
  drawTransport(time);
  if (time < PROJECT.durationSec - 0.0001) {
    state.animationFrame = requestAnimationFrame(playbackTick);
  }
}

function pausePlayback(options = {}) {
  const { save = true } = options;
  if (!state.isPlaying) return;
  state.currentTime = getCurrentPlaybackTime();
  state.isPlaying = false;
  cancelAnimationFrame(state.animationFrame);
  stopPlaybackSource();
  drawTransport(state.currentTime);
  if (save) saveProject(true);
}

async function seekTo(time, options = {}) {
  const { keepPlaying = false, save = true } = options;
  const wasPlaying = state.isPlaying;
  if (wasPlaying) {
    state.isPlaying = false;
    cancelAnimationFrame(state.animationFrame);
    stopPlaybackSource();
  }
  state.currentTime = clamp(time, 0, PROJECT.durationSec);
  drawTransport(state.currentTime);
  if (save) saveProject();
  if (wasPlaying && keepPlaying && !state.exporting) {
    await startPlayback();
  }
}

async function togglePlayback() {
  if (state.exporting) return;
  if (state.isPlaying) {
    pausePlayback();
  } else {
    await startPlayback();
  }
}

function buildOffsetDocument() {
  const offsetSec = offsetFramesToSec(state.offsetFrames);
  return {
    schema: "eight-flash/offset@1",
    projectId: PROJECT.id,
    generatedAt: new Date().toISOString(),
    timeline: {
      durationMs: PROJECT.durationSec * 1000,
      fps: PROJECT.fps,
      totalFrames: TOTAL_FRAMES,
      codec: "WebM",
      audio: "synthesized beat track",
    },
    alignment: {
      scope: "global",
      appliesTo: "entire-video-track",
      perFrameOffsets: false,
      offsetFrames: state.offsetFrames,
      offsetMs: Number(offsetFramesToMs(state.offsetFrames).toFixed(6)),
      direction:
        state.offsetFrames > 0
          ? "video-delayed"
          : state.offsetFrames < 0
            ? "video-advanced"
            : "in-sync",
      clamp: {
        minFrames: -MAX_OFFSET_FRAMES,
        maxFrames: MAX_OFFSET_FRAMES,
        maxAbsMs: PROJECT.maxOffsetMs,
      },
    },
    reproduceKey: projectStateHash(state.offsetFrames),
    audioEvents: AUDIO_EVENTS.map((event) => ({
      id: event.id,
      index: event.index,
      label: event.label,
      kind: "accent",
      timeMs: event.timeSec * 1000,
      frame: event.frame,
    })),
    flashes: FLASHES.map((flash) => {
      const visualHitTime = clamp(
        flash.timeSec + offsetSec,
        0,
        PROJECT.durationSec,
      );
      return {
        id: flash.id,
        index: flash.index,
        title: flash.title,
        audioEventId: flash.id.replace("flash-", "accent-"),
        sourceTimeMs: flash.timeSec * 1000,
        playbackTimeMs: Number((visualHitTime * 1000).toFixed(6)),
        sourceFrame: flash.frame,
        playbackFrame: Math.round(visualHitTime * PROJECT.fps),
      };
    }),
  };
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  return url;
}

function offsetFileName() {
  const sign = state.offsetFrames < 0 ? "m" : "p";
  return `eight-flash-offset-${sign}${Math.abs(state.offsetFrames)}f.json`;
}

function exportOffsetJson() {
  if (state.exporting) return null;
  saveProject(true);
  const documentData = buildOffsetDocument();
  const json = JSON.stringify(documentData, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, offsetFileName());
  showToast(
    `偏移 JSON 已生成：${formatOffset(state.offsetFrames)} ms / 全局 ${state.offsetFrames} 帧。`,
  );
  return documentData;
}

function supportedWebmMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function canUseWebCodecsExport() {
  if (
    typeof VideoEncoder !== "function" ||
    typeof AudioEncoder !== "function" ||
    typeof VideoFrame !== "function" ||
    typeof AudioData !== "function" ||
    typeof OfflineAudioContext !== "function"
  ) {
    return false;
  }
  try {
    const videoSupport = await VideoEncoder.isConfigSupported({
      codec: "vp8",
      width: PROJECT.width,
      height: PROJECT.height,
      bitrate: 4_000_000,
      framerate: PROJECT.fps,
    });
    const audioSupport = await AudioEncoder.isConfigSupported({
      codec: "opus",
      sampleRate: 48_000,
      numberOfChannels: 2,
      bitrate: 128_000,
    });
    return Boolean(videoSupport.supported && audioSupport.supported);
  } catch {
    return false;
  }
}

async function prepareExportAudioBuffer() {
  await ensureAudioReady();
  if (state.audioBuffer.sampleRate === 48_000) return state.audioBuffer;
  const sampleRate = 48_000;
  const frameCount = Math.round(PROJECT.durationSec * sampleRate);
  const offline = new OfflineAudioContext(2, frameCount, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = state.audioBuffer;
  source.connect(offline.destination);
  source.start(0);
  return offline.startRendering();
}

function exportFileName(extension) {
  const sign = state.offsetFrames >= 0 ? "p" : "m";
  return `eight-flash-global-${sign}${Math.abs(state.offsetFrames)}f.${extension}`;
}

async function exportWebmWebCodecs() {
  pausePlayback({ save: true });
  const resumeTime = state.currentTime;
  state.exporting = true;
  state.exportProgress = 0;
  elements.exportOverlay.hidden = false;
  elements.exportPercent.textContent = "0%";
  updateInterface(resumeTime);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: "V_VP8",
      width: PROJECT.width,
      height: PROJECT.height,
      frameRate: PROJECT.fps,
    },
    audio: {
      codec: "A_OPUS",
      sampleRate: 48_000,
      numberOfChannels: 2,
    },
  });

  let encoderFailure = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
    error: (error) => {
      encoderFailure = error;
    },
  });
  videoEncoder.configure({
    codec: "vp8",
    width: PROJECT.width,
    height: PROJECT.height,
    bitrate: 4_000_000,
    framerate: PROJECT.fps,
  });

  try {
    for (let frameIndex = 0; frameIndex < TOTAL_FRAMES; frameIndex += 1) {
      if (encoderFailure) throw encoderFailure;
      const mediaTime = frameIndex / PROJECT.fps;
      drawScene(context, videoTimeFor(mediaTime));
      const frame = new VideoFrame(elements.canvas, {
        timestamp: Math.round((frameIndex * 1_000_000) / PROJECT.fps),
        duration: Math.round(1_000_000 / PROJECT.fps),
      });
      videoEncoder.encode(frame, {
        keyFrame: frameIndex % PROJECT.fps === 0,
      });
      frame.close();
      if (videoEncoder.encodeQueueSize > 10) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      if (frameIndex % 9 === 0) {
        state.exportProgress = (frameIndex / TOTAL_FRAMES) * 0.82;
        elements.exportPercent.textContent = `${Math.floor(
          state.exportProgress * 100,
        )}%`;
      }
    }
    await videoEncoder.flush();
    videoEncoder.close();
    if (encoderFailure) throw encoderFailure;

    const audioBuffer = await prepareExportAudioBuffer();
    const sampleRate = audioBuffer.sampleRate;
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    const audioEncoder = new AudioEncoder({
      output: (chunk, metadata) => muxer.addAudioChunk(chunk, metadata),
      error: (error) => {
        encoderFailure = error;
      },
    });
    audioEncoder.configure({
      codec: "opus",
      sampleRate,
      numberOfChannels: 2,
      bitrate: 128_000,
    });

    const chunkFrames = sampleRate * 0.2;
    for (let start = 0; start < audioBuffer.length; start += chunkFrames) {
      if (encoderFailure) throw encoderFailure;
      const frames = Math.min(chunkFrames, audioBuffer.length - start);
      const data = new Float32Array(frames * 2);
      data.set(left.subarray(start, start + frames), 0);
      data.set(right.subarray(start, start + frames), frames);
      const audioData = new AudioData({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: Math.round((start * 1_000_000) / sampleRate),
        data,
      });
      audioEncoder.encode(audioData);
      audioData.close();
      if (audioEncoder.encodeQueueSize > 12) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      state.exportProgress = 0.82 + (start / audioBuffer.length) * 0.16;
      elements.exportPercent.textContent = `${Math.floor(
        state.exportProgress * 100,
      )}%`;
    }
    await audioEncoder.flush();
    audioEncoder.close();
    if (encoderFailure) throw encoderFailure;

    muxer.finalize();
    const blob = new Blob([target.buffer], {
      type: "video/webm;codecs=vp8,opus",
    });
    if (blob.size === 0) throw new Error("导出的 WebM 为空。");
    const fileName = exportFileName("webm");
    state.lastExportBlob = blob;
    state.lastExport = {
      blob,
      fileName,
      size: blob.size,
      mimeType: "video/webm;codecs=vp8,opus",
      exporter: "webcodecs-fixed-fps",
      frameRate: PROJECT.fps,
      frameCount: TOTAL_FRAMES,
      offsetFrames: state.offsetFrames,
      durationSec: PROJECT.durationSec,
      createdAt: new Date().toISOString(),
    };
    state.exporting = false;
    state.exportProgress = 1;
    elements.exportPercent.textContent = "100%";
    elements.exportOverlay.hidden = true;
    const url = downloadBlob(blob, fileName);
    state.lastExport.url = url;
    drawTransport(resumeTime);
    showToast(
      `WebM 已离线导出：900 帧 @ 30 fps，全局偏移 ${formatOffset(state.offsetFrames)} ms。`,
    );
    return state.lastExport;
  } catch (error) {
    try {
      videoEncoder.close();
    } catch {
      // Encoder may already be closed.
    }
    state.exporting = false;
    elements.exportOverlay.hidden = true;
    drawTransport(resumeTime);
    throw error;
  }
}

async function exportWebm() {
  if (state.exporting) return null;
  if (await canUseWebCodecsExport()) {
    try {
      return await exportWebmWebCodecs();
    } catch (error) {
      console.warn("WebCodecs export failed, using compatibility recorder.", error);
      showToast("离线编码不可用，正在切换到兼容录制模式。");
    }
  }
  return exportWebmRealtimeFallback();
}

async function exportWebmRealtimeFallback() {
  if (state.exporting) return null;
  const mimeType = supportedWebmMimeType();
  if (!mimeType || !elements.canvas.captureStream) {
    showToast("当前浏览器不支持 WebM 合流导出，请使用最新版 Chrome 或 Edge。");
    return null;
  }
  if (
    typeof MediaStream === "undefined" ||
    typeof MediaStreamAudioDestinationNode === "undefined"
  ) {
    showToast("当前浏览器缺少 WebM 音频合流能力。");
    return null;
  }

  pausePlayback({ save: true });
  const resumeTime = state.currentTime;
  state.exporting = true;
  state.exportProgress = 0;
  elements.exportOverlay.hidden = false;
  elements.exportPercent.textContent = "0%";
  drawScene(context, 0);
  updateInterface(resumeTime);

  let source = null;
  let canvasStream = null;
  let recorder = null;
  let exportFrame = 0;
  let finalizeTimer = 0;
  let finalized = false;

  try {
    const audioContext = await ensureAudioReady();
    const audioDestination = audioContext.createMediaStreamDestination();
    source = audioContext.createBufferSource();
    source.buffer = state.audioBuffer;
    source.connect(audioDestination);

    canvasStream = elements.canvas.captureStream(PROJECT.fps);
    const stream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...audioDestination.stream.getAudioTracks(),
    ]);
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 5_000_000,
      audioBitsPerSecond: 128_000,
    });
    const chunks = [];
    const recordingDone = new Promise((resolve, reject) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener("error", () => {
        reject(recorder.error || new Error("WebM 编码失败。"));
      });
      recorder.addEventListener("stop", () => {
        resolve(new Blob(chunks, { type: mimeType.split(";")[0] }));
      });
    });

    recorder.start(250);
    const audioStartCtxTime = audioContext.currentTime + 0.01;
    source.start(audioStartCtxTime);

    const updateExportFrame = () => {
      if (!state.exporting) return;
      const mediaTime = clamp(
        audioContext.currentTime - audioStartCtxTime,
        0,
        PROJECT.durationSec,
      );
      state.exportProgress = mediaTime / PROJECT.durationSec;
      elements.exportPercent.textContent = `${Math.min(
        99,
        Math.floor(state.exportProgress * 100),
      )}%`;
      drawScene(context, videoTimeFor(mediaTime));

      if (mediaTime >= PROJECT.durationSec - 0.001 && !finalized) {
        finalized = true;
        drawScene(context, videoTimeFor(PROJECT.durationSec));
        elements.exportPercent.textContent = "100%";
        finalizeTimer = window.setTimeout(() => {
          if (recorder && recorder.state !== "inactive") recorder.stop();
        }, 90);
        return;
      }
      exportFrame = requestAnimationFrame(updateExportFrame);
    };
    exportFrame = requestAnimationFrame(updateExportFrame);

    const blob = await recordingDone;
    window.clearTimeout(finalizeTimer);
    cancelAnimationFrame(exportFrame);
    try {
      source.stop();
    } catch {
      // The source may already have reached its natural end.
    }
    source.disconnect();
    canvasStream.getTracks().forEach((track) => track.stop());

    if (blob.size === 0) throw new Error("导出的 WebM 为空。");
    const fileName = `eight-flash-global-${state.offsetFrames >= 0 ? "p" : "m"}${Math.abs(state.offsetFrames)}f.webm`;
    state.lastExportBlob = blob;
    state.lastExport = {
      blob,
      fileName,
      size: blob.size,
      mimeType,
      offsetFrames: state.offsetFrames,
      durationSec: PROJECT.durationSec,
      createdAt: new Date().toISOString(),
    };
    state.exporting = false;
    elements.exportOverlay.hidden = true;
    const url = downloadBlob(blob, fileName);
    state.lastExport.url = url;
    drawTransport(resumeTime);
    showToast(
      `WebM 已完成（${(blob.size / 1024 / 1024).toFixed(1)} MB），全局偏移 ${formatOffset(state.offsetFrames)} ms。`,
    );
    return state.lastExport;
  } catch (error) {
    state.exporting = false;
    elements.exportOverlay.hidden = true;
    window.clearTimeout(finalizeTimer);
    cancelAnimationFrame(exportFrame);
    if (source) {
      try {
        source.stop();
      } catch {
        // Ignore cleanup errors after a failed export.
      }
    }
    if (canvasStream) canvasStream.getTracks().forEach((track) => track.stop());
    drawTransport(resumeTime);
    showToast(`导出失败：${error.message}`);
    throw error;
  }
}

function setOffsetFrames(value, options = {}) {
  if (state.exporting) return;
  const { notify = false } = options;
  const next = clampOffsetFrames(value);
  if (next === state.offsetFrames) return;
  state.offsetFrames = next;
  drawTransport(state.currentTime);
  saveProject(true);
  if (notify) {
    showToast(
      `全局偏移已设为 ${formatOffset(state.offsetFrames)} ms；八次闪烁同时移动。`,
    );
  }
}

function nudgeOffset(frames) {
  setOffsetFrames(state.offsetFrames + frames, { notify: true });
}

function timeFromTimelinePointer(event) {
  const geometry = getTimelineGeometry();
  const progress = clamp((event.clientX - geometry.startX) / geometry.width, 0, 1);
  return progress * PROJECT.durationSec;
}

function bindTimelineInteraction() {
  elements.timeline.addEventListener("pointerdown", (event) => {
    if (state.exporting || event.button !== 0) return;
    pausePlayback({ save: false });
    dragState = { pointerId: event.pointerId };
    elements.timeline.setPointerCapture(event.pointerId);
    seekTo(timeFromTimelinePointer(event), { save: false });
  });

  elements.timeline.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    seekTo(timeFromTimelinePointer(event), { save: false });
  });

  const endDrag = (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragState = null;
    saveProject(true);
    if (elements.timeline.hasPointerCapture(event.pointerId)) {
      elements.timeline.releasePointerCapture(event.pointerId);
    }
  };
  elements.timeline.addEventListener("pointerup", endDrag);
  elements.timeline.addEventListener("pointercancel", endDrag);

  elements.timeline.addEventListener("keydown", (event) => {
    if (state.exporting) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      seekTo(state.currentTime + direction, { keepPlaying: state.isPlaying });
    } else if (event.key === "Home") {
      event.preventDefault();
      seekTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      seekTo(PROJECT.durationSec);
    }
  });
}

function bindUi() {
  elements.playButton.addEventListener("click", () => {
    togglePlayback().catch((error) => showToast(`播放失败：${error.message}`));
  });
  elements.nudgeBack.addEventListener("click", () => nudgeOffset(-1));
  elements.nudgeForward.addEventListener("click", () => nudgeOffset(1));
  elements.resetOffsetButton.addEventListener("click", () => {
    setOffsetFrames(0, { notify: true });
  });
  elements.toStartButton.addEventListener("click", () => {
    pausePlayback({ save: false });
    seekTo(0);
  });
  elements.toEndButton.addEventListener("click", () => {
    pausePlayback({ save: false });
    seekTo(PROJECT.durationSec);
  });
  elements.jsonButton.addEventListener("click", () => exportOffsetJson());
  elements.exportButton.addEventListener("click", () => {
    exportWebm().catch(() => {
      // The toast and error state are handled inside the exporter.
    });
  });
  elements.reloadProjectButton.addEventListener("click", reloadSavedProject);
  bindTimelineInteraction();

  document.addEventListener("keydown", (event) => {
    if (state.exporting) return;
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      target.closest("button, input, textarea, select, [contenteditable='true']");
    if (event.code === "Space" && !typing) {
      event.preventDefault();
      togglePlayback().catch((error) => showToast(`播放失败：${error.message}`));
    } else if (
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      !typing &&
      event.altKey
    ) {
      event.preventDefault();
      nudgeOffset(event.key === "ArrowRight" ? 1 : -1);
    }
  });

  window.addEventListener("resize", () => {
    drawTransport(state.currentTime);
  });
  window.addEventListener("pagehide", () => {
    if (state.isPlaying) {
      state.currentTime = getCurrentPlaybackTime();
    }
    persistProject();
  });
}

function getDebugState() {
  const time = getCurrentPlaybackTime();
  return {
    projectId: PROJECT.id,
    durationSec: PROJECT.durationSec,
    fps: PROJECT.fps,
    totalFrames: TOTAL_FRAMES,
    offsetFrames: state.offsetFrames,
    offsetMs: offsetFramesToMs(state.offsetFrames),
    currentTime: time,
    currentFrame: currentFrameFor(time),
    isPlaying: state.isPlaying,
    isPaused: !state.isPlaying,
    exporting: state.exporting,
    exportProgress: state.exportProgress,
    flashCount: FLASHES.length,
    audioAccentCount: AUDIO_EVENTS.length,
    audioReady: Boolean(state.audioBuffer),
    lastScene: sceneStateAt(time),
    currentEvent: getLatestAudioEvent(time),
    reproduceKey: projectStateHash(state.offsetFrames),
    lastExport: state.lastExport
      ? {
          fileName: state.lastExport.fileName,
          size: state.lastExport.size,
          mimeType: state.lastExport.mimeType,
          exporter: state.lastExport.exporter || "mediarecorder",
          frameRate: state.lastExport.frameRate || null,
          frameCount: state.lastExport.frameCount || null,
          offsetFrames: state.lastExport.offsetFrames,
          durationSec: state.lastExport.durationSec,
          url: state.lastExport.url,
        }
      : null,
  };
}

function exposeTestApi() {
  window.__syncStudio = {
    getState: getDebugState,
    getOffsetDocument: buildOffsetDocument,
    getSceneAt: sceneStateAt,
    getFrameAt: currentFrameFor,
    getCanvasDataUrl: () => elements.canvas.toDataURL("image/png"),
    getVisualMarkerPositions: () =>
      [...elements.visualLane.querySelectorAll(".visual-marker")].map(
        (marker) => Number.parseFloat(marker.style.left),
      ),
    getAccentRms: (index, windowSec = 0.09) => {
      if (!state.audioBuffer) return null;
      const event = AUDIO_EVENTS[index];
      return event
        ? getAccentEnergy(state.audioBuffer, event.timeSec, windowSec)
        : null;
    },
    ensureAudio: ensureAudioReady,
    seek: (seconds) => seekTo(seconds, { save: false }),
    setOffsetFrames: (frames) => setOffsetFrames(frames),
    nudgeFrames: (frames) => nudgeOffset(frames),
    play: startPlayback,
    pause: () => pausePlayback(),
    reset: () => {
      pausePlayback({ save: false });
      state.offsetFrames = 0;
      state.currentTime = 0;
      drawTransport(0);
      saveProject(true);
    },
    reload: reloadSavedProject,
    exportOffsetJson,
    exportWebm,
  };
}

function initialize() {
  const restored = hydrateFromStorage();
  buildTimeline();
  bindUi();
  drawTransport(state.currentTime);
  exposeTestApi();
  if (restored) {
    showToast(
      `已恢复工程：全局偏移 ${formatOffset(state.offsetFrames)} ms。`,
    );
  }
}

initialize();
