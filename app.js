import { SceneAudioEngine } from "./audio-engine.js";
import {
  DEFAULT_SETTINGS,
  ENTRANCE_MS,
  MAX_DELAY_MS,
  SCENE_DURATION_MS,
  TRACKS,
  actualOffsetMs,
  formatSeconds
} from "./scene-config.js";

const STORAGE_KEY = "afterimage-project-v1";
const engine = new SceneAudioEngine();
const state = {
  settings: structuredClone(DEFAULT_SETTINGS),
  positionSeconds: 0,
  isPlaying: false,
  savedProject: null,
  dirty: false,
  observedPeaks: {}
};

const element = {
  body: document.body,
  stageObjects: document.getElementById("stageObjects"),
  stageTime: document.getElementById("stageTime"),
  transportTime: document.getElementById("transportTime"),
  transportStatus: document.getElementById("transportStatus"),
  playButton: document.getElementById("playButton"),
  resetButton: document.getElementById("resetButton"),
  masterVolume: document.getElementById("masterVolume"),
  masterVolumeOut: document.getElementById("masterVolumeOut"),
  mixer: document.getElementById("mixerMount"),
  saveButton: document.getElementById("saveButton"),
  reloadButton: document.getElementById("reloadButton"),
  projectState: document.getElementById("projectState"),
  ruler: document.getElementById("ruler"),
  laneLabels: document.getElementById("laneLabels"),
  laneTrack: document.getElementById("laneTrack"),
  playhead: document.getElementById("playhead"),
  playheadLabel: document.getElementById("playheadLabel"),
  timelineSpan: document.getElementById("timelineSpan"),
  toast: document.getElementById("toast")
};

let objectElements = new Map();
let clipElements = new Map();
let delayElements = new Map();
let meterElements = new Map();
let peakElements = new Map();
let playRestartToken = 0;

const visualMarkup = {
  ember: `
    <div class="ember-visual">
      <span class="ember-ring"></span>
      <span class="ember-ring"></span>
      <span class="ember-ring"></span>
      <div class="ember-core"></div>
    </div>`,
  air: `
    <svg class="air-visual" viewBox="0 0 320 200" preserveAspectRatio="none" aria-hidden="true">
      <path class="air-path air-path--ghost" d="M8 111C48 55 84 160 139 111S224 30 312 94"/>
      <path class="air-path" d="M8 111C48 55 84 160 139 111S224 30 312 94"/>
      <circle class="air-node" cx="8" cy="111" r="2.2"/>
      <circle class="air-node" cx="139" cy="111" r="2.2"/>
      <circle class="air-node" cx="312" cy="94" r="2.2"/>
    </svg>`,
  tide: `
    <div class="tide-visual">
      <span class="tide-slit"></span>
    </div>`,
  prism: `
    <div class="prism-visual">
      <span class="prism-facet"></span>
    </div>`
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatClock(milliseconds) {
  const safeMs = clamp(milliseconds, 0, SCENE_DURATION_MS);
  const minutes = Math.floor(safeMs / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const ms = Math.floor(safeMs % 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function formatPeak(db) {
  if (!Number.isFinite(db)) return "—";
  return `${db.toFixed(1).replace("-", "−")} dB`;
}

function offsetPercent(milliseconds) {
  return (milliseconds / SCENE_DURATION_MS) * 100;
}

function currentTrackDelay(trackId) {
  return state.settings.delaysMs[trackId];
}

function currentTrackOffset(track) {
  return actualOffsetMs(track, currentTrackDelay(track.id));
}

function renderMixer() {
  element.mixer.innerHTML = `
    <div class="mixer-head">
      <div>
        <span class="eyebrow">MIXER / LIVE ANALYSIS</span>
        <h2>四轨混音</h2>
      </div>
      <span class="sync-state"><i></i>SYNCED</span>
    </div>
    <div class="mixer-summary">
      <div class="summary-metrics">
        <div class="summary-metric"><span>总时长</span><strong id="totalDuration">8.000s</strong></div>
        <div class="summary-metric"><span>最晚入场</span><strong id="latestOffset">1.800s</strong></div>
        <div class="summary-metric"><span>静音轨道</span><strong id="mutedCount">0 / 4</strong></div>
      </div>
      <div class="master-row">
        <label for="mixerVolume">主音量</label>
        <input id="mixerVolume" type="range" min="0" max="100" value="${Math.round(state.settings.masterVolume * 100)}">
        <output id="mixerVolumeOut" for="mixerVolume">${Math.round(state.settings.masterVolume * 100)}</output>
      </div>
      <p class="mixer-hint">静音只关闭该轨声音，四条画面时间线继续独立运行。</p>
    </div>
    <div class="track-list">
      ${TRACKS.map((track) => `
        <article class="track-card" data-track-id="${track.id}" style="--track-color:${track.color}">
          <div class="track-head">
            <span class="track-number">${track.number}</span>
            <div class="track-info">
              <span class="track-name">${track.name}</span>
              <span class="track-kind">${track.englishName} / ${track.kind}</span>
            </div>
            <button class="mute-button" type="button" data-action="mute" data-track="${track.id}"
              aria-label="静音 ${track.name}" aria-pressed="false">M</button>
          </div>
          <div class="delay-row delay-control">
            <label>DELAY</label>
            <div class="delay-stepper">
              <button class="stepper-button" type="button" data-action="delay-down" data-track="${track.id}" aria-label="${track.name} 减少 20 毫秒">−</button>
              <input type="number" data-action="delay-input" data-track="${track.id}" value="0"
                min="0" max="${MAX_DELAY_MS}" step="20" aria-label="${track.name}延迟（毫秒）">
              <span class="delay-unit">ms</span>
              <button class="stepper-button" type="button" data-action="delay-up" data-track="${track.id}" aria-label="${track.name} 增加 20 毫秒">+</button>
            </div>
            <div class="delay-presets">
              <button class="preset-button" type="button" data-action="delay-add" data-delta="120"
                data-track="${track.id}" title="增加 120 毫秒">+120</button>
            </div>
          </div>
          <div class="track-stats">
            <div class="track-stat"><span>实际偏移</span><strong class="actual-offset" data-role="offset"></strong></div>
            <div class="track-stat"><span>时长</span><strong>${formatSeconds(track.durationMs / 1000, 2)}</strong></div>
            <div class="track-stat"><span>峰值</span><strong data-role="peak">${formatPeak(track.peakDb)}</strong></div>
          </div>
          <div class="live-meter" aria-hidden="true"><i></i></div>
        </article>
      `).join("")}
    </div>
    <div class="verify-panel" id="verifyPanel">
      <div class="verify-head">
        <div>
          <span class="eyebrow">SYNC CHECK / 120MS</span>
          <strong>入场同步验证</strong>
        </div>
        <span class="verify-badge" id="verifyBadge">待验证</span>
      </div>
      <p class="verify-copy" id="verifyCopy">将「流风」向后移动 120ms，核对对象入场与首音事件。</p>
      <div class="verify-actions">
        <button class="verify-button" id="verifyButton" type="button">运行 +120ms 验证</button>
      </div>
      <div class="verify-results" id="verifyResults" hidden></div>
    </div>`;

  meterElements = new Map();
  peakElements = new Map();
  element.mixer.querySelectorAll(".live-meter").forEach((meter) => {
    const card = meter.closest(".track-card");
    meterElements.set(card.dataset.trackId, meter);
  });
  element.mixer.querySelectorAll("[data-role='peak']").forEach((peak) => {
    peakElements.set(peak.closest(".track-card").dataset.trackId, peak);
  });
}

function renderStage() {
  element.stageObjects.innerHTML = TRACKS.map((track) => `
    <div class="stage-object" data-track-id="${track.id}" data-offset-ms="${currentTrackOffset(track)}"
      data-entered="false" style="--track-color:${track.color}">
      <div class="object-glow"></div>
      <div class="object-body">
        <span class="entrance-ring"></span>
        ${visualMarkup[track.id]}
      </div>
      <div class="object-caption">
        <span class="object-number">${track.number}</span>
        <span>${track.name} ${track.englishName}</span>
        <span class="object-time" data-role="object-time">T+${formatSeconds(currentTrackOffset(track) / 1000, 3)}</span>
      </div>
    </div>
  `).join("");
  objectElements = new Map();
  element.stageObjects.querySelectorAll(".stage-object").forEach((object) => {
    objectElements.set(object.dataset.trackId, object);
  });
}

function renderTimeline() {
  element.ruler.innerHTML = Array.from({ length: 9 }, (_, index) => `
    <span class="ruler-tick" style="left:${offsetPercent(index * 1000)}%">${index.toFixed(0)}s</span>
  `).join("");
  element.laneLabels.innerHTML = TRACKS.map((track) => `
    <span class="lane-label" style="--track-color:${track.color}">
      <i></i>${track.number} ${track.name}
    </span>
  `).join("");

  element.laneTrack.innerHTML = `
    <div class="lane-grid" aria-hidden="true"></div>
    ${TRACKS.map((track) => `
      <div class="lane-row" data-track="${track.id}">
        <div class="entry-ghost" data-role="entry-ghost"></div>
        <div class="delay-segment" data-role="delay-segment"></div>
        <div class="clip" data-role="clip" data-track-id="${track.id}" style="--clip-color:${track.color}">
          <span class="clip-entry"></span>
        </div>
      </div>
    `).join("")}
    <div class="playhead" id="playhead"><span id="playheadLabel">0.000</span></div>
  `;
  element.playhead = document.getElementById("playhead");
  element.playheadLabel = document.getElementById("playheadLabel");
  clipElements = new Map();
  delayElements = new Map();
  element.laneTrack.querySelectorAll("[data-role='clip']").forEach((clip) => {
    clipElements.set(clip.dataset.trackId, clip);
  });
  element.laneTrack.querySelectorAll(".lane-row").forEach((row) => {
    delayElements.set(row.dataset.track, {
      delay: row.querySelector("[data-role='delay-segment']"),
      ghost: row.querySelector("[data-role='entry-ghost']")
    });
  });
}

function refreshMixer() {
  TRACKS.forEach((track) => {
    const card = element.mixer.querySelector(`[data-track-id="${track.id}"].track-card`);
    if (!card) return;
    const delay = currentTrackDelay(track.id);
    const offsetMs = actualOffsetMs(track, delay);
    const muted = state.settings.muted[track.id];
    card.classList.toggle("is-muted", muted);
    const muteButton = card.querySelector(".mute-button");
    muteButton.setAttribute("aria-pressed", String(muted));
    const input = card.querySelector(".delay-stepper input");
    if (document.activeElement !== input) input.value = String(delay);
    const offset = card.querySelector("[data-role='offset']");
    offset.textContent = formatSeconds(offsetMs / 1000, 3);
    const measuredPeak = state.observedPeaks[track.id];
    peakElements.get(track.id).textContent = formatPeak(
      Number.isFinite(measuredPeak) ? measuredPeak : track.peakDb
    );
  });

  const latest = Math.max(...TRACKS.map(currentTrackOffset));
  const mutedCount = TRACKS.filter((track) => state.settings.muted[track.id]).length;
  document.getElementById("latestOffset").textContent = formatSeconds(latest / 1000, 3);
  document.getElementById("mutedCount").textContent = `${mutedCount} / ${TRACKS.length}`;
  document.getElementById("totalDuration").textContent = formatSeconds(SCENE_DURATION_MS / 1000, 3);
  element.timelineSpan.textContent = `总时长 ${formatSeconds(SCENE_DURATION_MS / 1000, 3)}`;

  const volumeValue = Math.round(state.settings.masterVolume * 100);
  element.masterVolume.value = String(volumeValue);
  element.masterVolumeOut.textContent = String(volumeValue);
  const mixerVolume = document.getElementById("mixerVolume");
  const mixerVolumeOut = document.getElementById("mixerVolumeOut");
  if (mixerVolume) mixerVolume.value = String(volumeValue);
  if (mixerVolumeOut) mixerVolumeOut.textContent = String(volumeValue);
}

function refreshTimeline() {
  TRACKS.forEach((track) => {
    const delay = currentTrackDelay(track.id);
    const offsetMs = actualOffsetMs(track, delay);
    const clip = clipElements.get(track.id);
    clip.style.left = `${offsetPercent(offsetMs)}%`;
    clip.style.width = `${offsetPercent(track.durationMs)}%`;
    clip.dataset.offsetMs = String(offsetMs);
    clip.dataset.delayMs = String(delay);
    const delayParts = delayElements.get(track.id);
    delayParts.delay.style.left = `${offsetPercent(track.baseOffsetMs)}%`;
    delayParts.delay.style.width = `${offsetPercent(delay)}%`;
    delayParts.ghost.style.left = `${offsetPercent(track.baseOffsetMs)}%`;
    delayParts.ghost.hidden = delay === 0;
  });

  TRACKS.forEach((track) => {
    const object = objectElements.get(track.id);
    const offsetMs = currentTrackOffset(track);
    object.dataset.offsetMs = String(offsetMs);
    object.querySelector("[data-role='object-time']").textContent = `T+${formatSeconds(offsetMs / 1000, 3)}`;
  });
}

function refreshAll() {
  refreshMixer();
  refreshTimeline();
}

function setTransportUi(status = null) {
  element.body.classList.toggle("is-playing", state.isPlaying);
  element.playButton.setAttribute("aria-label", state.isPlaying ? "暂停" : "播放");
  if (status) {
    element.transportStatus.textContent = status;
  } else if (state.isPlaying) {
    element.transportStatus.textContent = "PLAYING";
  } else if (state.positionSeconds >= SCENE_DURATION_MS / 1000 - 0.002) {
    element.transportStatus.textContent = "END";
  } else if (state.positionSeconds > 0) {
    element.transportStatus.textContent = "PAUSED";
  } else {
    element.transportStatus.textContent = "READY";
  }
}

function updateVisuals(positionSeconds, levels = null) {
  const audioLevels = levels || engine.getLevels();
  const positionMs = positionSeconds * 1000;

  TRACKS.forEach((track, index) => {
    const object = objectElements.get(track.id);
    const offsetMs = currentTrackOffset(track);
    const localMs = positionMs - offsetMs;
    const entered = localMs >= 0;
    const progress = entered ? clamp(localMs / ENTRANCE_MS, 0, 1) : 0;
    const eased = 1 - Math.pow(1 - progress, 3);
    const animationSeconds = Math.max(0, localMs) / 1000;
    const level = audioLevels[track.id]?.level || 0;
    const bob = entered
      ? Math.sin(animationSeconds * 1.55 + index * 1.6) * (2 + level * 5)
      : 0;
    const drift = entered
      ? Math.cos(animationSeconds * 0.82 + index) * (0.6 + level * 1.8)
      : 0;
    const translateY = entered ? (1 - eased) * 30 + bob : 18;
    const scale = entered ? 0.65 + eased * 0.35 : 0.72;
    const opacity = entered ? 0.38 + eased * 0.62 : 0.27;

    object.style.transform = `translate3d(${drift}px, ${translateY}px, 0) scale(${scale})`;
    object.style.opacity = opacity.toFixed(3);
    object.style.setProperty("--enter", progress.toFixed(4));
    object.style.setProperty("--flash", entered && localMs < ENTRANCE_MS ? (1 - progress).toFixed(4) : "0");
    object.style.setProperty("--level", level.toFixed(4));
    object.dataset.entered = String(entered);
    object.dataset.progress = progress.toFixed(4);
    object.dataset.localTime = String(Math.round(localMs));
    object.classList.toggle("is-muted", state.settings.muted[track.id]);

    const meter = meterElements.get(track.id);
    if (meter) meter.style.setProperty("--meter", level.toFixed(4));

    const db = audioLevels[track.id]?.db;
    if (state.isPlaying && Number.isFinite(db) && db > -56) {
      const previous = state.observedPeaks[track.id];
      if (!Number.isFinite(previous) || db > previous) {
        state.observedPeaks[track.id] = db;
        const peak = peakElements.get(track.id);
        if (peak) peak.textContent = formatPeak(db);
      }
    }
  });
}

function updateTransportDisplay(positionSeconds) {
  const milliseconds = clamp(positionSeconds * 1000, 0, SCENE_DURATION_MS);
  element.stageTime.textContent = formatClock(milliseconds);
  element.transportTime.textContent = formatClock(milliseconds);
  const percent = offsetPercent(milliseconds);
  element.playhead.style.left = `${percent}%`;
  element.playheadLabel.textContent = (milliseconds / 1000).toFixed(3);
  element.laneTrack.setAttribute("aria-valuenow", (milliseconds / 1000).toFixed(3));
  element.laneTrack.setAttribute("aria-valuetext", `${(milliseconds / 1000).toFixed(3)} 秒`);
}

function animationFrame() {
  const position = engine.getPosition();
  state.positionSeconds = position;

  if (state.isPlaying && position >= SCENE_DURATION_MS / 1000 - 0.004) {
    if (state.settings.loop) {
      state.isPlaying = false;
      void beginPlayback(0);
    } else {
      finishPlayback();
    }
  }

  updateTransportDisplay(position);
  updateVisuals(position);
  requestAnimationFrame(animationFrame);
}

async function beginPlayback(fromSeconds) {
  const token = ++playRestartToken;
  const from = clamp(fromSeconds, 0, SCENE_DURATION_MS / 1000);
  try {
    await engine.play(from);
    if (token !== playRestartToken) return;
    state.positionSeconds = from;
    state.isPlaying = true;
    state.observedPeaks = {};
    element.body.classList.add("has-played");
    setTransportUi("PLAYING");
    updateTransportDisplay(from);
  } catch (error) {
    console.error(error);
    showToast("音频启动失败，请检查浏览器的自动播放设置");
  }
}

function finishPlayback() {
  if (!state.isPlaying) return;
  state.isPlaying = false;
  engine.pause();
  engine.positionSeconds = SCENE_DURATION_MS / 1000;
  state.positionSeconds = SCENE_DURATION_MS / 1000;
  setTransportUi("END");
  updateTransportDisplay(state.positionSeconds);
  showToast("八秒场景结束 · 四条时间线保持独立");
}

async function togglePlayback() {
  if (state.isPlaying) {
    playRestartToken += 1;
    engine.pause();
    state.positionSeconds = engine.getPosition();
    state.isPlaying = false;
    setTransportUi("PAUSED");
    return;
  }
  const from = state.positionSeconds >= SCENE_DURATION_MS / 1000 - 0.002
    ? 0
    : state.positionSeconds;
  await beginPlayback(from);
}

function resetScene() {
  playRestartToken += 1;
  engine.pause();
  void engine.seek(0);
  state.positionSeconds = 0;
  state.isPlaying = false;
  state.observedPeaks = {};
  element.body.classList.remove("has-played");
  setTransportUi("READY");
  refreshMixer();
  updateTransportDisplay(0);
  updateVisuals(0, Object.fromEntries(TRACKS.map((track) => [track.id, { level: 0, db: -Infinity }])));
}

async function reconcilePlayback() {
  if (!state.isPlaying) return;
  const token = ++playRestartToken;
  const position = engine.getPosition();
  try {
    await engine.play(position);
    if (token !== playRestartToken) return;
    state.positionSeconds = position;
    state.observedPeaks = {};
    setTransportUi("PLAYING");
  } catch (error) {
    console.error(error);
    showToast("无法重建同步时间线");
  }
}

let toastTimer = 0;

function showToast(message) {
  window.clearTimeout(toastTimer);
  element.toast.textContent = message;
  element.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    element.toast.classList.remove("is-visible");
  }, 2400);
}

function normalizeSettings(raw = {}) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  TRACKS.forEach((track) => {
    const delay = Number(raw.delaysMs?.[track.id]);
    settings.delaysMs[track.id] = Number.isFinite(delay)
      ? clamp(Math.round(delay), 0, MAX_DELAY_MS)
      : 0;
    settings.muted[track.id] = Boolean(raw.muted?.[track.id]);
  });
  const volume = Number(raw.masterVolume);
  settings.masterVolume = Number.isFinite(volume) ? clamp(volume, 0, 1) : DEFAULT_SETTINGS.masterVolume;
  settings.loop = Boolean(raw.loop);
  return settings;
}

function savedTimeLabel(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function setProjectBadge(text, isSaved) {
  element.projectState.innerHTML = `<i></i>${text}`;
  element.projectState.classList.toggle("is-saved", isSaved);
}

function markDirty() {
  state.dirty = true;
  if (state.savedProject) {
    setProjectBadge("有未保存更改", false);
  } else {
    setProjectBadge("未保存工程", false);
  }
}

function readStoredProject() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveProject() {
  const project = {
    version: 1,
    title: "余像 · 四声道入场练习",
    sceneDurationMs: SCENE_DURATION_MS,
    settings: structuredClone(state.settings),
    savedAt: Date.now()
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    state.savedProject = project;
    state.dirty = false;
    element.reloadButton.disabled = false;
    setProjectBadge(`已保存 ${savedTimeLabel(project.savedAt)}`, true);
    showToast("工程已保存到本地 · 可随时重新载入");
  } catch {
    showToast("浏览器禁止本地存储，工程未能保存");
  }
}

async function loadProject() {
  const stored = readStoredProject() || state.savedProject;
  if (!stored) {
    showToast("还没有可载入的工程");
    return;
  }
  playRestartToken += 1;
  engine.pause();
  await engine.seek(0);
  state.settings = normalizeSettings(stored.settings);
  engine.updateSettings(state.settings);
  state.positionSeconds = 0;
  state.isPlaying = false;
  state.observedPeaks = {};
  state.savedProject = stored;
  state.dirty = false;
  element.body.classList.remove("has-played");
  refreshAll();
  clearVerification();
  setTransportUi("READY");
  updateTransportDisplay(0);
  updateVisuals(0, Object.fromEntries(TRACKS.map((track) => [track.id, { level: 0, db: -Infinity }])));
  setProjectBadge(`已载入 ${savedTimeLabel(stored.savedAt)}`, true);
  showToast("工程已重新载入 · 偏移、静音与主音量已恢复");
}

function clearVerification() {
  const badge = document.getElementById("verifyBadge");
  const copy = document.getElementById("verifyCopy");
  const results = document.getElementById("verifyResults");
  if (!badge || !copy || !results) return;
  badge.textContent = "待验证";
  badge.className = "verify-badge";
  copy.textContent = "将「流风」向后移动 120ms，核对对象入场与首音事件。";
  results.hidden = true;
  results.innerHTML = "";
  document.getElementById("verifyPanel").classList.remove("has-results");
}

function setDelay(trackId, requestedDelay, notify = false, preserveVerification = false) {
  const track = TRACKS.find((item) => item.id === trackId);
  if (!track) return;
  const delay = clamp(Math.round(Number(requestedDelay) || 0), 0, MAX_DELAY_MS);
  if (delay === state.settings.delaysMs[trackId]) return;
  state.settings.delaysMs[trackId] = delay;
  engine.updateSettings(state.settings);
  markDirty();
  if (!preserveVerification) clearVerification();
  refreshAll();
  if (state.isPlaying) void reconcilePlayback();
  if (notify) {
    showToast(`${track.name} 延迟 ${delay}ms · 入场声画同步偏移`);
  }
}

function runSyncCheck() {
  const air = TRACKS.find((track) => track.id === "air");
  const before = getSnapshot();
  const beforeAir = before.tracks.find((track) => track.id === air.id);
  const targetDelay = Math.min(beforeAir.delayMs + 120, MAX_DELAY_MS);
  if (targetDelay === beforeAir.delayMs) {
    showToast("流风已到达最大延迟，请先减小延迟再验证");
    return;
  }
  setDelay(air.id, targetDelay, false, true);
  const after = getSnapshot();
  const afterAir = after.tracks.find((track) => track.id === air.id);
  const otherTracks = before.tracks.filter((track) => track.id !== air.id);
  const untouched = otherTracks.every((trackBefore) => {
    const trackAfter = after.tracks.find((track) => track.id === trackBefore.id);
    return trackAfter.actualOffsetMs === trackBefore.actualOffsetMs
      && trackAfter.firstAudioEventMs === trackBefore.firstAudioEventMs
      && trackAfter.visualOffsetMs === trackBefore.visualOffsetMs;
  });
  const movedBy = afterAir.actualOffsetMs - beforeAir.actualOffsetMs;
  const soundAndVisualAligned = afterAir.firstAudioEventMs === afterAir.actualOffsetMs
    && afterAir.soundVisualAligned;
  const sceneLengthHeld = after.totalDurationMs === SCENE_DURATION_MS;
  const checks = [soundAndVisualAligned, untouched, movedBy === 120 && sceneLengthHeld];
  const passed = checks.filter(Boolean).length;
  const allPassed = passed === checks.length;

  const badge = document.getElementById("verifyBadge");
  const copy = document.getElementById("verifyCopy");
  const results = document.getElementById("verifyResults");
  badge.textContent = allPassed ? `PASS ${passed}/3` : `FAIL ${passed}/3`;
  badge.className = `verify-badge ${allPassed ? "is-pass" : "is-fail"}`;
  copy.textContent = `${air.name} ${formatSeconds(beforeAir.actualOffsetMs / 1000, 3)} → ${formatSeconds(afterAir.actualOffsetMs / 1000, 3)}；对象入场与首音事件读取同一偏移。`;
  results.innerHTML = `
    <div class="verify-result-row">
      <i>${soundAndVisualAligned ? "✓" : "×"}</i><strong>声画同步</strong>
      <span>首音 ${afterAir.firstAudioEventMs}ms = 入场 ${afterAir.visualOffsetMs}ms</span>
    </div>
    <div class="verify-result-row">
      <i>${untouched ? "✓" : "×"}</i><strong>其他三轨</strong>
      <span>${untouched ? "实际偏移与首音均未改变" : "检测到非预期偏移"}</span>
    </div>
    <div class="verify-result-row">
      <i>${movedBy === 120 && sceneLengthHeld ? "✓" : "×"}</i><strong>场景时长</strong>
      <span>移动 ${movedBy}ms · 总时长 ${formatSeconds(after.totalDurationMs / 1000, 3)}</span>
    </div>`;
  results.hidden = false;
  document.getElementById("verifyPanel").classList.add("has-results");
  showToast(allPassed
    ? "验证通过：流风声画同步移动 120ms，其余三轨保持不变"
    : "验证未通过，请检查时间线调度");
}

function setMuted(trackId, muted) {
  const track = TRACKS.find((item) => item.id === trackId);
  if (!track) return;
  state.settings.muted[trackId] = Boolean(muted);
  engine.setTrackMute(trackId, state.settings.muted[trackId]);
  markDirty();
  refreshMixer();
  updateVisuals(engine.getPosition());
  showToast(`${track.name}${muted ? "已静音" : "恢复发声"} · 四条画面继续运行`);
}

function setMasterVolumeFromPercent(percent) {
  state.settings.masterVolume = clamp(Number(percent) / 100, 0, 1);
  engine.setMasterVolume(state.settings.masterVolume);
  markDirty();
  refreshMixer();
}

async function seekTo(seconds) {
  const position = clamp(Number(seconds) || 0, 0, SCENE_DURATION_MS / 1000);
  const wasPlaying = state.isPlaying;
  const token = ++playRestartToken;
  state.positionSeconds = position;
  await engine.seek(position);
  if (token !== playRestartToken) return;
  state.isPlaying = wasPlaying;
  setTransportUi(wasPlaying ? "PLAYING" : (position >= 8 ? "END" : "PAUSED"));
  updateTransportDisplay(position);
  updateVisuals(position, Object.fromEntries(TRACKS.map((track) => [track.id, { level: 0, db: -Infinity }])));
}

function handleMixerClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const trackId = button.dataset.track;
  const action = button.dataset.action;
  if (action === "mute") {
    setMuted(trackId, !state.settings.muted[trackId]);
  }
  if (action === "delay-down") {
    setDelay(trackId, currentTrackDelay(trackId) - 20);
  }
  if (action === "delay-up") {
    setDelay(trackId, currentTrackDelay(trackId) + 20);
  }
  if (action === "delay-add") {
    const delta = Number(button.dataset.delta);
    setDelay(trackId, currentTrackDelay(trackId) + delta, true);
  }
}

function bindEvents() {
  element.playButton.addEventListener("click", () => void togglePlayback());
  element.resetButton.addEventListener("click", resetScene);
  element.saveButton.addEventListener("click", saveProject);
  element.reloadButton.addEventListener("click", () => void loadProject());

  element.masterVolume.addEventListener("input", (event) => {
    setMasterVolumeFromPercent(event.target.value);
  });

  element.mixer.addEventListener("click", handleMixerClick);
  element.mixer.addEventListener("click", (event) => {
    if (event.target.closest("#verifyButton")) runSyncCheck();
  });
  element.mixer.addEventListener("input", (event) => {
    if (event.target.id === "mixerVolume") {
      setMasterVolumeFromPercent(event.target.value);
    }
  });
  element.mixer.addEventListener("change", (event) => {
    if (event.target.dataset.action === "delay-input") {
      setDelay(event.target.dataset.track, event.target.value, true);
      event.target.value = String(currentTrackDelay(event.target.dataset.track));
    }
  });
  element.mixer.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.dataset.action === "delay-input") {
      event.target.blur();
    }
  });

  element.laneTrack.addEventListener("click", (event) => {
    const rect = element.laneTrack.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    void seekTo(ratio * (SCENE_DURATION_MS / 1000));
  });

  document.addEventListener("keydown", (event) => {
    const tag = event.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    if (event.code === "Space") {
      event.preventDefault();
      void togglePlayback();
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      void seekTo(state.positionSeconds - 0.25);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      void seekTo(state.positionSeconds + 0.25);
    }
  });
}

function getSnapshot() {
  const position = engine.getPosition();
  updateVisuals(position);
  const plan = engine.getPlanSnapshot();
  return {
    sceneDurationMs: SCENE_DURATION_MS,
    totalDurationMs: SCENE_DURATION_MS,
    positionSeconds: position,
    positionMs: Math.round(position * 1000),
    isPlaying: state.isPlaying,
    audioContextState: engine.context?.state || "not-created",
    playbackAnchor: {
      startPositionMs: Math.round(engine.startPosition * 1000),
      startContextTime: engine.startContextTime,
      contextNow: engine.context?.currentTime ?? null
    },
    settings: structuredClone(state.settings),
    tracks: TRACKS.map((track) => {
      const trackPlan = plan.find((item) => item.id === track.id);
      const object = objectElements.get(track.id);
      const card = element.mixer.querySelector(`[data-track-id="${track.id}"].track-card`);
      const firstScheduled = engine.schedule.find((event) => event.trackId === track.id);
      return {
        id: track.id,
        name: track.name,
        delayMs: currentTrackDelay(track.id),
        actualOffsetMs: trackPlan.actualOffsetMs,
        firstAudioEventMs: trackPlan.firstEventMs,
        lastAudioEventMs: trackPlan.lastEventMs,
        audioEventTimesMs: trackPlan.eventTimesMs,
        durationMs: track.durationMs,
        peakDb: track.peakDb,
        muted: state.settings.muted[track.id],
        visualEntered: object.dataset.entered === "true",
        visualProgress: Number(object.dataset.progress),
        visualLocalTimeMs: Number(object.dataset.localTime),
        visualOffsetMs: Number(object.dataset.offsetMs),
        visualTransform: object.style.transform,
        cardOffsetText: card.querySelector("[data-role='offset']").textContent,
        scheduledFirstEventMs: firstScheduled
          ? Math.round((firstScheduled.contextTime - engine.startContextTime) * 1000 + engine.startPosition * 1000)
          : null,
        scheduledContextOffsetMs: firstScheduled
          ? Math.round((firstScheduled.contextTime - engine.startContextTime) * 1000)
          : null,
        soundVisualAligned: trackPlan.actualOffsetMs === Number(object.dataset.offsetMs)
      };
    })
  };
}

window.sceneApp = {
  getSnapshot,
  seek: (seconds) => seekTo(seconds),
  setDelay: (trackId, delayMs) => {
    setDelay(trackId, delayMs);
    updateVisuals(engine.getPosition());
  },
  setMuted,
  play: () => togglePlayback(),
  pause: () => togglePlayback(),
  reset: resetScene,
  saveProject,
  loadProject: () => loadProject()
};

function initialize() {
  renderMixer();
  renderStage();
  renderTimeline();
  bindEvents();
  state.savedProject = readStoredProject();
  if (state.savedProject) {
    element.reloadButton.disabled = false;
    setProjectBadge(`上次保存 ${savedTimeLabel(state.savedProject.savedAt)}`, true);
  }
  refreshAll();
  updateTransportDisplay(0);
  updateVisuals(0, Object.fromEntries(TRACKS.map((track) => [track.id, { level: 0, db: -Infinity }])));
  requestAnimationFrame(animationFrame);
}

initialize();
