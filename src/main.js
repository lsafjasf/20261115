import "@fontsource-variable/noto-sans-sc";
import "./style.css";
import {
  BPM,
  DURATION,
  PROPERTIES,
  PROPERTY_LABELS,
  addAllKeyframes,
  countKeyframes,
  createDefaultProject,
  currentKeyframe,
  evaluateLayer,
  formatTime,
  frameAt,
  normalizeTime,
  sampleTrack,
  setKeyframe,
  toggleKeyframe,
  validateProject,
} from "./model.js";
import { drawPoster } from "./renderer.js";
import { BeatEngine, drawWaveform } from "./audio.js";
import { exportLoop } from "./recorder.js";

const STORAGE_KEY = "pulse-poster-project-v1";
const audio = new BeatEngine();
const canvas = document.querySelector("#posterCanvas");

function loadStoredProject() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return validateProject(JSON.parse(stored));
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return createDefaultProject();
}

const state = {
  project: loadStoredProject(),
  currentTime: 0,
  playing: false,
  loop: true,
  audioEnabled: true,
  guide: false,
  selectedLayerId: "title",
  selectedProperty: "position",
  playAnchor: 0,
  animationFrame: 0,
  saveTimer: 0,
  exportJob: null,
  exportUrl: null,
  lastExport: null,
  toastTimer: 0,
};

const dom = {
  saveState: document.querySelector("#saveState"),
  layerList: document.querySelector("#layerList"),
  canvasLayerName: document.querySelector("#canvasLayerName"),
  frameCounter: document.querySelector("#frameCounter"),
  currentTimeLabel: document.querySelector("#currentTimeLabel"),
  playhead: document.querySelector("#playhead"),
  playheadTime: document.querySelector("#playheadTime"),
  playButton: document.querySelector("#playButton"),
  playIcon: document.querySelector("#playIcon"),
  currentTime: document.querySelector("#currentTimeLabel"),
  trackLabels: document.querySelector("#trackLabels"),
  trackLanes: document.querySelector("#trackLanes"),
  timelineMain: document.querySelector("#timelineMain"),
  ruler: document.querySelector("#ruler"),
  beatGrid: document.querySelector("#beatGrid"),
  waveform: document.querySelector("#waveform"),
  selectedLayerName: document.querySelector("#selectedLayerName"),
  selectedType: document.querySelector("#selectedType"),
  inspectorSwatch: document.querySelector("#inspectorSwatch"),
  positionX: document.querySelector("#positionX"),
  positionY: document.querySelector("#positionY"),
  opacityRange: document.querySelector("#opacityRange"),
  opacityInput: document.querySelector("#opacityInput"),
  colorInput: document.querySelector("#colorInput"),
  colorChip: document.querySelector("#colorChip"),
  hexInput: document.querySelector("#hexInput"),
  keyframeCount: document.querySelector("#keyframeCount"),
  keyframeSummary: document.querySelector("#keyframeSummary"),
  keyframeTime: document.querySelector("#keyframeTime"),
  safeFrame: document.querySelector("#safeFrame"),
  toast: document.querySelector("#toast"),
  exportModal: document.querySelector("#exportModal"),
  renderState: document.querySelector("#renderState"),
  replayState: document.querySelector("#replayState"),
  modalFooter: document.querySelector("#modalFooter"),
  modalTitle: document.querySelector("#modalTitle"),
  modalSubtitle: document.querySelector("#modalSubtitle"),
  renderCanvas: document.querySelector("#renderCanvas"),
  renderProgress: document.querySelector("#renderProgress"),
  renderTime: document.querySelector("#renderTime"),
  replayVideo: document.querySelector("#replayVideo"),
  downloadLink: document.querySelector("#downloadLink"),
  fileMeta: document.querySelector("#fileMeta"),
};

function activeLayer() {
  return (
    state.project.layers.find((layer) => layer.id === state.selectedLayerId) ||
    state.project.layers[0]
  );
}

function displayTime() {
  return state.currentTime >= DURATION ? DURATION : normalizeTime(state.currentTime);
}

function labelColor(hex) {
  return hex || "#ff5c35";
}

function renderLayerList() {
  dom.layerList.replaceChildren();
  state.project.layers.forEach((layer) => {
    const button = document.createElement("button");
    button.className = `layer-item${layer.id === state.selectedLayerId ? " is-selected" : ""}${layer.visible ? "" : " is-muted"}`;
    button.type = "button";
    button.dataset.layerId = layer.id;
    const evaluated = evaluateLayer(layer, state.currentTime);
    button.style.setProperty("--layer-color", labelColor(evaluated.color));

    const thumb = document.createElement("span");
    thumb.className = `layer-thumb thumb-${layer.kind}`;
    thumb.style.setProperty("--accent", evaluated.color);

    const copy = document.createElement("span");
    copy.className = "layer-copy";
    const name = document.createElement("strong");
    name.textContent = layer.name;
    const meta = document.createElement("span");
    meta.textContent = `${layer.type} / ${countKeyframes(layer)} KEYS`;
    copy.append(name, meta);

    const count = document.createElement("span");
    count.className = "layer-key-count";
    count.textContent = String(countKeyframes(layer));
    button.append(thumb, copy, count);
    button.addEventListener("click", () => {
      selectLayer(layer.id, "position");
    });
    dom.layerList.append(button);
  });
}

function renderRuler() {
  dom.ruler.replaceChildren();
  dom.beatGrid.replaceChildren();
  for (let tick = 0; tick <= 24; tick += 1) {
    const second = tick / 2;
    const left = (second / DURATION) * 100;
    const label = document.createElement("span");
    label.className = `ruler-label${tick % 4 === 0 ? " is-major" : ""}`;
    label.style.left = `${left}%`;
    if (tick % 2 === 0) label.textContent = String(second);
    dom.ruler.append(label);

    const line = document.createElement("span");
    line.className = `beat-line${tick === 0 ? " is-major" : tick % 4 === 0 ? " is-second" : ""}`;
    line.style.left = `${left}%`;
    dom.beatGrid.append(line);
  }
}

function trackKeyTitle(layer, property, key) {
  const time = formatTime(key.t, false);
  if (property === "position") return `${time}s · X ${Math.round(key.x)} Y ${Math.round(key.y)}`;
  if (property === "opacity") return `${time}s · ${Math.round(key.v * 100)}%`;
  return `${time}s · ${key.v.toUpperCase()}`;
}

function renderTracks() {
  dom.trackLabels.replaceChildren();
  dom.trackLanes.replaceChildren();

  state.project.layers.forEach((layer) => {
    const evaluated = evaluateLayer(layer, state.currentTime);
    PROPERTIES.forEach((property) => {
      const selected =
        layer.id === state.selectedLayerId && property === state.selectedProperty;
      const label = document.createElement("div");
      label.className = `track-label${selected ? " is-selected" : ""}`;
      label.style.setProperty("--layer-color", evaluated.color);
      label.dataset.layerId = layer.id;
      label.dataset.property = property;

      const dot = document.createElement("span");
      dot.className = "track-label-dot";
      const name = document.createElement("span");
      name.className = "track-label-name";
      const bold = document.createElement("b");
      bold.textContent = layer.name;
      const small = document.createElement("span");
      small.textContent = PROPERTY_LABELS[property];
      name.append(bold, small);

      const add = document.createElement("button");
      add.type = "button";
      add.className = "track-add";
      add.title = `添加${PROPERTY_LABELS[property]}关键帧`;
      add.innerHTML = '<svg viewBox="0 0 16 16"><path d="M8 2v12M2 8h12"/></svg>';
      add.addEventListener("click", (event) => {
        event.stopPropagation();
        addTrackKeyframe(layer.id, property);
      });
      label.append(dot, name, add);
      label.addEventListener("click", () => {
        state.playing = false;
        stopPlayback();
        state.selectedLayerId = layer.id;
        state.selectedProperty = property;
        refreshEditor();
      });
      dom.trackLabels.append(label);

      const lane = document.createElement("div");
      lane.className = `track-lane${selected ? " is-selected" : ""}`;
      lane.style.setProperty("--layer-color", evaluated.color);
      lane.dataset.layerId = layer.id;
      lane.dataset.property = property;
      const guide = document.createElement("span");
      guide.className = "key-line";
      lane.append(guide);

      const keys = layer.tracks[property] || [];
      keys.forEach((key) => {
        const marker = document.createElement("button");
        marker.type = "button";
        marker.className = "keyframe";
        marker.style.left = `${(key.t / DURATION) * 100}%`;
        marker.title = trackKeyTitle(layer, property, key);
        marker.dataset.time = String(key.t);
        if (
          Math.abs(normalizeTime(state.currentTime) - key.t) <= 0.025 ||
          Math.abs(state.currentTime - key.t) <= 0.025
        ) {
          marker.classList.add("is-current");
        }
        marker.addEventListener("click", (event) => {
          event.stopPropagation();
          stopPlayback();
          state.selectedLayerId = layer.id;
          state.selectedProperty = property;
          setTime(key.t);
          refreshEditor();
        });
        lane.append(marker);
      });
      lane.addEventListener("click", (event) => {
        event.stopPropagation();
        state.selectedLayerId = layer.id;
        state.selectedProperty = property;
        setTime(timeFromPointer(event.clientX));
        refreshEditor();
      });
      dom.trackLanes.append(lane);
    });
  });

  syncTrackColors();
}

function syncTrackColors() {
  const evaluated = evaluateLayer(activeLayer(), state.currentTime);
  dom.trackLabels.querySelectorAll(".track-label").forEach((node) => {
    if (node.dataset.layerId === state.selectedLayerId) {
      node.style.setProperty("--layer-color", evaluated.color);
    }
  });
  dom.trackLanes.querySelectorAll(".track-lane").forEach((node) => {
    if (node.dataset.layerId === state.selectedLayerId) {
      node.style.setProperty("--layer-color", evaluated.color);
    }
  });
}

function renderInspector() {
  const layer = activeLayer();
  if (!layer) return;
  const value = evaluateLayer(layer, state.currentTime);
  dom.selectedLayerName.textContent = layer.name;
  dom.selectedType.textContent = layer.type;
  dom.inspectorSwatch.style.setProperty("--accent", value.color);
  dom.canvasLayerName.textContent = layer.name;

  if (!document.activeElement?.matches?.("#positionX, #positionY")) {
    dom.positionX.value = String(Math.round(value.position.x));
    dom.positionY.value = String(Math.round(value.position.y));
  }
  if (!document.activeElement?.matches?.("#opacityInput")) {
    dom.opacityInput.value = String(Math.round(value.opacity * 100));
  }
  dom.opacityRange.value = String(Math.round(value.opacity * 100));
  dom.opacityRange.style.setProperty(
    "--range-progress",
    `${Math.round(value.opacity * 100)}%`,
  );

  if (!document.activeElement?.matches?.("#hexInput")) {
    dom.hexInput.value = value.color.replace("#", "").toUpperCase();
  }
  dom.colorInput.value = value.color;
  dom.colorChip.style.background = value.color;

  dom.keyframeCount.textContent = String(countKeyframes(layer));
  dom.keyframeTime.textContent = normalizeTime(state.currentTime)
    .toFixed(2)
    .padStart(5, "0");
  dom.keyframeSummary.replaceChildren();
  PROPERTIES.forEach((property) => {
    const keys = layer.tracks[property] || [];
    const section = document.createElement("div");
    section.className = "summary-row";
    const keyLabel = document.createElement("span");
    keyLabel.textContent = PROPERTY_LABELS[property];
    const keyCount = document.createElement("span");
    keyCount.textContent = `${keys.length} KEYS`;
    if (currentKeyframe(keys, normalizeTime(state.currentTime))) {
      keyCount.textContent += " / AT PLAYHEAD";
      keyCount.style.color = "var(--accent)";
    }
    section.append(keyLabel, keyCount);
    dom.keyframeSummary.append(section);
  });

  document.querySelectorAll(".keyframe-button").forEach((button) => {
    const property = button.dataset.keyframeProperty;
    const has = Boolean(
      currentKeyframe(layer.tracks[property], normalizeTime(state.currentTime)),
    );
    button.classList.toggle("has-key", has);
  });
}

function refreshEditor() {
  renderLayerList();
  renderTracks();
  renderInspector();
  syncTimeUI();
  drawFrame();
}

function selectLayer(layerId, property = "position") {
  state.selectedLayerId = layerId;
  state.selectedProperty = property;
  refreshEditor();
}

function drawFrame() {
  drawPoster(canvas, state.project, state.currentTime);
}

function fitCanvasToStage() {
  const stage = document.querySelector("#stage");
  const shell = document.querySelector("#canvasShell");
  if (!stage || !shell) return;
  const bounds = stage.getBoundingClientRect();
  const availableWidth = Math.max(260, bounds.width - 100);
  const availableHeight = Math.max(325, bounds.height - 58);
  const height = Math.min(availableHeight, availableWidth * 1.25, 720);
  shell.style.width = `${height * 0.8}px`;
  shell.style.height = `${height}px`;
}

function syncTimeUI() {
  const time = Math.max(0, Math.min(DURATION, state.currentTime));
  dom.currentTimeLabel.textContent = formatTime(time, true);
  dom.playheadTime.textContent = time.toFixed(2).padStart(5, "0");
  dom.playhead.style.left = `${(time / DURATION) * 100}%`;
  dom.frameCounter.textContent = String(frameAt(time) + 1).padStart(3, "0");
  dom.trackLanes.querySelectorAll(".keyframe").forEach((marker) => {
    marker.classList.toggle(
      "is-current",
      Math.abs(Number(marker.dataset.time) - time) <= 0.025 ||
        (time >= DURATION - 0.025 && Number(marker.dataset.time) <= 0.025),
    );
  });
}

function setTime(time, options = {}) {
  const clamped = Math.max(0, Math.min(DURATION, Number(time) || 0));
  state.currentTime = clamped;
  if (!options.keepPlaying) {
    syncTimeUI();
    if (!state.playing) {
      drawFrame();
      renderInspector();
      syncTrackColors();
    }
  }
}

function timeFromPointer(clientX) {
  const bounds = dom.timelineMain.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)) * DURATION;
}

function addTrackKeyframe(layerId, property) {
  const layer = state.project.layers.find((item) => item.id === layerId);
  if (!layer) return;
  const value = sampleTrack(layer, property, state.currentTime);
  setKeyframe(state.project, layerId, property, state.currentTime, value);
  state.selectedLayerId = layerId;
  state.selectedProperty = property;
  scheduleSave();
  refreshEditor();
  showToast(`${layer.name} · ${PROPERTY_LABELS[property]}关键帧已添加`);
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove("is-visible");
  }, 2200);
}

function setPlayIcon(playing) {
  dom.playButton.classList.toggle("is-playing", playing);
  dom.playIcon.innerHTML = playing
    ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>'
    : '<path d="m8 5 11 7-11 7V5Z"/>';
  dom.playButton.title = playing ? "暂停" : "播放";
  dom.waveform.classList.toggle("is-playing", playing && state.audioEnabled);
}

function updatePlaybackFrame() {
  if (!state.playing) return;
  const elapsed = (performance.now() - state.playAnchor) / 1000;
  if (elapsed >= DURATION) {
    if (state.loop) {
      state.playAnchor += DURATION * 1000;
      state.currentTime = Math.max(0, (performance.now() - state.playAnchor) / 1000);
    } else {
      state.currentTime = DURATION;
      state.playing = false;
      audio.stopPreview();
      setPlayIcon(false);
      drawFrame();
      syncTimeUI();
      renderInspector();
      return;
    }
  } else {
    state.currentTime = elapsed;
  }

  drawFrame();
  syncTimeUI();
  syncTrackColors();
  if (Math.floor(performance.now() / 110) % 2 === 0) renderInspector();
  state.animationFrame = requestAnimationFrame(updatePlaybackFrame);
}

async function startPlayback() {
  if (state.playing) return;
  if (state.currentTime >= DURATION - 0.001) state.currentTime = 0;
  if (state.audioEnabled) await audio.ensure();
  state.playing = true;
  state.playAnchor = performance.now() - state.currentTime * 1000;
  if (state.audioEnabled) {
    audio.startPreview(state.currentTime);
    state.playAnchor += 45;
  }
  setPlayIcon(true);
  state.animationFrame = requestAnimationFrame(updatePlaybackFrame);
}

function stopPlayback() {
  if (!state.playing) {
    audio.stopPreview();
    return;
  }
  state.playing = false;
  cancelAnimationFrame(state.animationFrame);
  audio.stopPreview();
  setPlayIcon(false);
  drawFrame();
  syncTimeUI();
  renderInspector();
}

function togglePlayback() {
  if (state.playing) {
    stopPlayback();
    showToast(`已暂停于 ${formatTime(state.currentTime, false)}s`);
  } else {
    startPlayback();
  }
}

function scheduleSave() {
  dom.saveState.classList.add("is-saving");
  dom.saveState.lastChild.textContent = " 正在保存";
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
    } catch {
      // Storage can be unavailable in private browsing; explicit export still works.
    }
    dom.saveState.classList.remove("is-saving");
    dom.saveState.lastChild.textContent = " 已自动保存";
  }, 420);
}

function projectFileName(extension) {
  const base = state.project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "pulse-poster"}-${extension}`;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function saveProjectJson() {
  const json = JSON.stringify(
    {
      ...state.project,
      savedAt: new Date().toISOString(),
      editor: { duration: DURATION, bpm: BPM, fps: 30 },
    },
    null,
    2,
  );
  const blob = new Blob([json], { type: "application/json" });
  downloadBlob(blob, projectFileName("json"));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
  showToast("工程 JSON 已保存");
}

async function importProject(file) {
  try {
    const text = await file.text();
    const project = validateProject(JSON.parse(text));
    stopPlayback();
    state.project = project;
    state.currentTime = 0;
    state.selectedLayerId = project.layers[0]?.id || "";
    state.selectedProperty = "position";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    refreshEditor();
    showToast(`已载入工程 · ${project.layers.length} 个图层`);
  } catch (error) {
    showToast(`导入失败：${error.message}`);
  }
}

function updateKeyframeFromInput(property, value) {
  setKeyframe(
    state.project,
    state.selectedLayerId,
    property,
    state.currentTime,
    value,
  );
  scheduleSave();
  drawFrame();
  renderLayerList();
  renderTracks();
  renderInspector();
  syncTimeUI();
}

function handlePositionInput(axis) {
  const layer = activeLayer();
  const current = sampleTrack(layer, "position", state.currentTime);
  const input = axis === "x" ? dom.positionX : dom.positionY;
  const next = Number(input.value) || 0;
  updateKeyframeFromInput("position", {
    x: axis === "x" ? next : current.x,
    y: axis === "y" ? next : current.y,
  });
}

function togglePropertyKeyframe(property) {
  const layer = activeLayer();
  const result = toggleKeyframe(
    state.project,
    layer.id,
    property,
    state.currentTime,
  );
  scheduleSave();
  refreshEditor();
  showToast(
    result.added
      ? `${layer.name} · ${PROPERTY_LABELS[property]}关键帧已添加`
      : `${layer.name} · ${PROPERTY_LABELS[property]}关键帧已移除`,
  );
}

function resetExportModal() {
  dom.replayState.classList.add("is-hidden");
  dom.renderState.classList.remove("is-hidden");
  dom.modalFooter.classList.remove("is-hidden");
  dom.modalTitle.textContent = "正在渲染 12 秒循环";
  dom.modalSubtitle.textContent = "WebM · VP9 + OPUS · 1080 × 1350";
  dom.renderProgress.style.width = "0%";
  dom.renderTime.textContent = "00.0 / 12.0s";
  dom.exportModal.classList.add("is-open");
  dom.exportModal.setAttribute("aria-hidden", "false");
  drawPoster(dom.renderCanvas, state.project, 0);
}

function closeExportModal(options = {}) {
  if (state.exportJob && !options.keepJob) {
    state.exportJob.cancel();
    state.exportJob = null;
  }
  dom.replayVideo.pause();
  dom.exportModal.classList.remove("is-open");
  dom.exportModal.setAttribute("aria-hidden", "true");
}

async function beginExport() {
  if (state.exportJob) return;
  stopPlayback();
  state.currentTime = 0;
  syncTimeUI();
  drawFrame();
  resetExportModal();
  state.exportToken = (state.exportToken || 0) + 1;
  const token = state.exportToken;

  try {
    state.exportJob = exportLoop({
      canvas,
      project: state.project,
      audio,
      onProgress(progress, time) {
        dom.renderProgress.style.width = `${(progress * 100).toFixed(1)}%`;
        dom.renderTime.textContent = `${time.toFixed(1).padStart(4, "0")} / 12.0s`;
      },
      onFrame(time) {
        drawPoster(dom.renderCanvas, state.project, time);
        state.currentTime = time;
        syncTimeUI();
      },
    });

    const result = await state.exportJob.promise;
    if (token !== state.exportToken) return;
    state.exportJob = null;
    state.lastExport = result;

    if (state.exportUrl) URL.revokeObjectURL(state.exportUrl);
    state.exportUrl = URL.createObjectURL(result.blob);
    dom.replayVideo.src = state.exportUrl;
    dom.replayVideo.load();
    dom.downloadLink.href = state.exportUrl;
    dom.downloadLink.download = result.fileName;
    dom.fileMeta.textContent = `${(result.blob.size / 1024 / 1024).toFixed(2)} MB · VP9 + OPUS · 12.0s`;
    dom.renderState.classList.add("is-hidden");
    dom.replayState.classList.remove("is-hidden");
    dom.modalFooter.classList.add("is-hidden");
    dom.modalTitle.textContent = "12 秒循环已导出";
    dom.modalSubtitle.textContent = "正在回放实际 WebM 文件 · 视频与音频同轨";
    dom.replayVideo.currentTime = 0;
    dom.replayVideo.play().catch(() => {});
    showToast("WebM 导出完成，正在回放");

    state.lastExport = {
      ...result,
      url: state.exportUrl,
    };
  } catch (error) {
    if (token !== state.exportToken) return;
    state.exportJob = null;
    dom.modalTitle.textContent = "导出未完成";
    dom.modalSubtitle.textContent = error.message;
    dom.modalFooter.innerHTML =
      '<span>请重新点击导出再试一次</span><button class="text-button" id="cancelExport">关闭</button>';
    document.querySelector("#cancelExport")?.addEventListener("click", () => {
      closeExportModal();
    });
  }
}

function bindTimelineScrubbing() {
  let dragging = false;

  const begin = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".keyframe")) return;
    dragging = true;
    stopPlayback();
    dom.timelineMain.setPointerCapture?.(event.pointerId);
    dom.playhead.classList.add("is-dragging");
    setTime(timeFromPointer(event.clientX));
    renderInspector();
  };

  const move = (event) => {
    if (!dragging) return;
    setTime(timeFromPointer(event.clientX));
    renderInspector();
    syncTrackColors();
  };

  const end = (event) => {
    if (!dragging) return;
    dragging = false;
    dom.timelineMain.releasePointerCapture?.(event.pointerId);
    dom.playhead.classList.remove("is-dragging");
    renderInspector();
    renderTracks();
  };

  dom.timelineMain.addEventListener("pointerdown", begin);
  dom.timelineMain.addEventListener("pointermove", move);
  dom.timelineMain.addEventListener("pointerup", end);
  dom.timelineMain.addEventListener("pointercancel", end);
}

function bindControls() {
  dom.playButton.addEventListener("click", togglePlayback);
  document.querySelector("#loopButton").addEventListener("click", (event) => {
    state.loop = !state.loop;
    event.currentTarget.classList.toggle("is-on", state.loop);
    event.currentTarget.setAttribute("aria-pressed", String(state.loop));
  });

  document.querySelector("#audioToggle").addEventListener("click", async (event) => {
    state.audioEnabled = !state.audioEnabled;
    audio.setEnabled(state.audioEnabled);
    event.currentTarget.classList.toggle("is-on", state.audioEnabled);
    event.currentTarget.setAttribute("aria-pressed", String(state.audioEnabled));
    event.currentTarget.querySelector("span").textContent = state.audioEnabled ? "ON" : "OFF";
    if (state.audioEnabled && state.playing) {
      await audio.ensure();
      audio.startPreview(state.currentTime);
    }
    setPlayIcon(state.playing);
  });

  document.querySelector("#guideToggle").addEventListener("click", (event) => {
    state.guide = !state.guide;
    event.currentTarget.classList.toggle("is-active", state.guide);
    dom.safeFrame.classList.toggle("is-visible", state.guide);
  });

  document.querySelector("#fitButton").addEventListener("click", () => {
    const shell = document.querySelector("#canvasShell");
    fitCanvasToStage();
    shell.animate(
      [
        { transform: "scale(0.985)", opacity: 0.8 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration: 220, easing: "ease-out" },
    );
    showToast("画布已适配视窗 · 1080 × 1350");
  });

  document.querySelector("#addLayerButton").addEventListener("click", () => {
    showToast("演示工程包含主标题、几何背景、活动信息三层");
  });

  document.querySelector("#saveButton").addEventListener("click", saveProjectJson);
  document.querySelector("#importButton").addEventListener("click", () => {
    document.querySelector("#fileInput").click();
  });
  document.querySelector("#fileInput").addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) importProject(file);
    event.target.value = "";
  });

  document.querySelector("#visibilityToggle").addEventListener("click", () => {
    const layer = activeLayer();
    layer.visible = !layer.visible;
    scheduleSave();
    refreshEditor();
    showToast(`${layer.name}${layer.visible ? "已显示" : "已隐藏"}`);
  });

  document.querySelectorAll(".keyframe-button").forEach((button) => {
    button.addEventListener("click", () => {
      togglePropertyKeyframe(button.dataset.keyframeProperty);
    });
  });

  document.querySelector("#addKeyframeButton").addEventListener("click", () => {
    const layer = activeLayer();
    addAllKeyframes(state.project, layer.id, state.currentTime);
    scheduleSave();
    refreshEditor();
    showToast(`${layer.name} · 已写入 3 组关键帧`);
  });

  dom.positionX.addEventListener("change", () => handlePositionInput("x"));
  dom.positionY.addEventListener("change", () => handlePositionInput("y"));
  dom.opacityRange.addEventListener("input", () => {
    const percent = Number(dom.opacityRange.value);
    updateKeyframeFromInput("opacity", { v: percent / 100 });
  });
  dom.opacityInput.addEventListener("change", () => {
    const percent = Math.max(0, Math.min(100, Number(dom.opacityInput.value) || 0));
    updateKeyframeFromInput("opacity", { v: percent / 100 });
  });
  dom.colorInput.addEventListener("input", () => {
    updateKeyframeFromInput("color", { v: dom.colorInput.value.toLowerCase() });
  });
  dom.hexInput.addEventListener("change", () => {
    const value = dom.hexInput.value.replace(/[^0-9a-f]/gi, "").padStart(6, "0").slice(0, 6);
    updateKeyframeFromInput("color", { v: `#${value}`.toLowerCase() });
  });

  document.querySelector("#exportButton").addEventListener("click", beginExport);
  document.querySelector("#cancelExport").addEventListener("click", () => {
    state.exportToken = (state.exportToken || 0) + 1;
    closeExportModal();
    showToast("已取消导出");
  });
  document.querySelector("#modalClose").addEventListener("click", () => {
    if (state.exportJob) {
      state.exportToken = (state.exportToken || 0) + 1;
      closeExportModal();
    } else {
      closeExportModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const isTyping =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable;
    if (isTyping) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    }
    if (event.code === "ArrowRight") {
      event.preventDefault();
      stopPlayback();
      setTime(Math.min(DURATION, state.currentTime + (event.shiftKey ? 1 : 1 / 30)));
      renderInspector();
      renderTracks();
    }
    if (event.code === "ArrowLeft") {
      event.preventDefault();
      stopPlayback();
      setTime(Math.max(0, state.currentTime - (event.shiftKey ? 1 : 1 / 30)));
      renderInspector();
      renderTracks();
    }
  });
}

function exposeTestApi() {
  window.__pulse = {
    get project() {
      return state.project;
    },
    get time() {
      return state.currentTime;
    },
    get lastExport() {
      return state.lastExport;
    },
    get exportOpen() {
      return dom.exportModal.classList.contains("is-open");
    },
    get replayVisible() {
      return !dom.replayState.classList.contains("is-hidden");
    },
    setTime(time) {
      stopPlayback();
      setTime(time);
      renderInspector();
      renderTracks();
    },
    selectLayer,
    beginExport,
    audio,
  };
}

async function init() {
  fitCanvasToStage();
  drawWaveform(dom.waveform);
  renderRuler();
  renderLayerList();
  renderTracks();
  renderInspector();
  syncTimeUI();
  drawFrame();
  bindTimelineScrubbing();
  bindControls();
  exposeTestApi();

  const layer = activeLayer();
  if (layer) state.selectedLayerId = layer.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.project));
  const resizeObserver = new ResizeObserver(fitCanvasToStage);
  resizeObserver.observe(document.querySelector("#stage"));
}

init();
