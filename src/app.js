import { SCENES, createSceneState } from "./scenes.js";
import { ProjectionRenderer, opacityAt } from "./renderer.js";
import { MechanicalAudio } from "./audio.js";

const STORAGE_KEY = "shadowbox-atelier.v1";
const TOTAL_TIME = 8;
const DEFAULT_TIME = 2.8;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function mergeState(defaults, saved) {
  if (!saved || typeof saved !== "object") return defaults;
  const light = { ...defaults.light, ...(saved.light || {}) };
  return {
    ...defaults,
    ...saved,
    angles: defaults.angles.map((angle, index) => (
      Number.isFinite(saved.angles?.[index]) ? clamp(saved.angles[index], -180, 180) : angle
    )),
    spacings: defaults.spacings.map((spacing, index) => (
      Number.isFinite(saved.spacings?.[index]) ? saved.spacings[index] : spacing
    )),
    light: {
      x: Number.isFinite(light.x) ? clamp(light.x, 0.76, 0.97) : defaults.light.x,
      y: Number.isFinite(light.y) ? clamp(light.y, 0.08, 0.92) : defaults.light.y,
      distance: Number.isFinite(light.distance) ? clamp(light.distance, 12, 100) : defaults.light.distance,
      height: Number.isFinite(light.height) ? clamp(light.height, 12, 88) : defaults.light.height,
    },
    timeline: defaults.timeline.map((fade, index) => {
      const candidate = saved.timeline?.[index];
      if (!candidate) return fade;
      const fadeIn = Number.isFinite(candidate.in) ? clamp(candidate.in, 0, TOTAL_TIME - 0.3) : fade.in;
      const fadeOut = Number.isFinite(candidate.out) ? clamp(candidate.out, fadeIn + 0.3, TOTAL_TIME) : fade.out;
      return { in: fadeIn, out: fadeOut };
    }),
    currentTime: Number.isFinite(saved.currentTime)
      ? clamp(saved.currentTime, 0, TOTAL_TIME)
      : defaults.currentTime,
    complete: Boolean(saved.complete),
  };
}

function readSavedSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

class ShadowBoxApp {
  constructor() {
    this.canvas = document.getElementById("stageCanvas");
    this.renderer = new ProjectionRenderer(this.canvas);
    this.audio = new MechanicalAudio(true);
    this.activeIndex = 0;
    this.playing = false;
    this.metrics = null;
    this.lastMeasure = 0;
    this.lastFrame = performance.now();
    this.lastAudioTick = 0;
    this.fpsFrames = 0;
    this.fpsStarted = performance.now();
    this.persistTimer = 0;
    this.measureTimer = 0;
    this.dragging = null;
    this.savedSessions = readSavedSessions();
    this.sceneStates = {};
    this.cacheElements();
    this.loadStates();
    this.buildSceneList();
    this.bindStaticControls();
    this.activateScene(this.activeIndex, { initial: true });
    this.exposeTestApi();
    requestAnimationFrame((now) => this.loop(now));
  }

  cacheElements() {
    const ids = [
      "sceneList", "completeCount", "progressLabel", "progressFill", "sceneIndex",
      "sceneMood", "sceneTitle", "stageState", "inspectorTitle", "inspectorNumber",
      "sceneDescription", "layerControls", "lightIntensity", "lightIntensityValue",
      "lightHeight", "lightHeightValue", "silhouetteValue", "silhouetteMeter",
      "exposureValue", "exposureMeter", "warningNote", "warningText",
      "saveSceneButton", "saveSceneLabel", "saveStatus", "timelineLabels",
      "timelineTracks", "timelineRuler", "playButton", "timecode", "timelineReset",
      "soundButton", "exportButton", "toast", "toastText", "exportFlash",
      "burnCallout", "diagnosticStrip", "dragHint", "canvasFrame", "fpsReadout",
    ];
    this.els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    this.els.playhead = document.getElementById("playhead");
    this.els.tabs = [...document.querySelectorAll(".inspector-tab")];
    this.els.panels = [...document.querySelectorAll(".parameter-panel")];
    this.els.presets = [...document.querySelectorAll("[data-light-preset]")];
  }

  loadStates() {
    for (const scene of SCENES) {
      const defaults = createSceneState(scene);
      this.sceneStates[scene.id] = mergeState(defaults, this.savedSessions?.scenes?.[scene.id]);
    }
    const savedIndex = this.savedSessions?.activeIndex;
    this.activeIndex = Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < SCENES.length
      ? savedIndex
      : 0;
  }

  get scene() {
    return SCENES[this.activeIndex];
  }

  get state() {
    return this.sceneStates[this.scene.id];
  }

  buildSceneList() {
    this.els.sceneList.innerHTML = SCENES.map((scene, index) => `
      <button class="scene-card" type="button" data-scene="${index}" aria-selected="false">
        <span class="scene-card-index">${String(index + 1).padStart(2, "0")} · ${scene.accent.replace("CH. ", "CH ")}</span>
        <span class="scene-card-mark" data-mark>${String(index + 1).padStart(2, "0")}</span>
        <span class="scene-card-title">${scene.title}</span>
        <span class="scene-card-mood">${scene.english} · ${scene.mood}</span>
      </button>
    `).join("");
    this.els.sceneList.querySelectorAll(".scene-card").forEach((card) => {
      card.addEventListener("click", () => {
        const index = Number(card.dataset.scene);
        if (index !== this.activeIndex) this.activateScene(index);
      });
    });
  }

  bindStaticControls() {
    this.els.tabs.forEach((tab) => {
      tab.addEventListener("click", () => this.setInspectorPanel(tab.dataset.panel));
    });
    this.els.lightIntensity.addEventListener("input", (event) => {
      this.state.light.distance = Number(event.target.value);
      this.els.lightIntensityValue.textContent = event.target.value;
      this.setRangeFill(event.target);
      this.audio.sweep(0.7);
      this.changed();
    });
    this.els.lightHeight.addEventListener("input", (event) => {
      const height = Number(event.target.value);
      this.state.light.height = height;
      this.state.light.y = clamp(1 - height / 100 * 0.86 - 0.07, 0.08, 0.92);
      this.els.lightHeightValue.textContent = event.target.value;
      this.setRangeFill(event.target);
      this.audio.sweep(0.8);
      this.changed();
    });
    this.els.presets.forEach((button) => {
      button.addEventListener("click", () => this.applyLightPreset(button.dataset.lightPreset));
    });
    this.els.saveSceneButton.addEventListener("click", () => this.saveCurrentScene());
    this.els.playButton.addEventListener("click", () => this.togglePlayback());
    this.els.timelineReset.addEventListener("click", () => this.resetTimeline());
    this.els.soundButton.addEventListener("click", () => this.toggleSound());
    this.els.exportButton.addEventListener("click", () => this.exportFrame());
    this.bindCanvasLight();
    this.bindTimeline();
    window.addEventListener("resize", () => {
      this.renderer.resize();
      this.updatePlayhead();
    });
    window.addEventListener("beforeunload", () => this.persistNow());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.persistNow();
    });
  }

  activateScene(index, options = {}) {
    if (!options.initial && index === this.activeIndex) return;
    if (!options.initial) this.persistNow();
    this.activeIndex = clamp(index, 0, SCENES.length - 1);
    const scene = this.scene;
    const state = this.state;
    this.playing = false;
    this.els.playButton.classList.remove("is-playing");
    this.buildLayerControls();
    this.buildTimeline();
    this.updateSceneChrome();
    this.measureNow();
    this.persistNow();
    this.setInspectorPanel("layersPanel");
    document.body.dataset.scene = scene.id;
    if (!options.initial) {
      this.audio.ratchet();
      this.showToast(`已切换 · 第 ${String(this.activeIndex + 1).padStart(2, "0")} 幕 ${scene.title}`);
    }
  }

  updateSceneChrome() {
    const scene = this.scene;
    const state = this.state;
    const indexLabel = String(this.activeIndex + 1).padStart(2, "0");
    this.els.sceneIndex.textContent = `SCENE ${indexLabel}`;
    this.els.sceneMood.textContent = scene.mood;
    this.els.sceneTitle.textContent = scene.title;
    this.els.inspectorTitle.textContent = scene.title;
    this.els.inspectorNumber.textContent = indexLabel;
    this.els.sceneDescription.textContent = scene.description;
    this.els.lightIntensity.value = state.light.distance;
    this.els.lightIntensityValue.textContent = Math.round(state.light.distance);
    this.els.lightHeight.value = state.light.height;
    this.els.lightHeightValue.textContent = Math.round(state.light.height);
    this.setRangeFill(this.els.lightIntensity);
    this.setRangeFill(this.els.lightHeight);

    this.els.sceneList.querySelectorAll(".scene-card").forEach((card, cardIndex) => {
      const isActive = cardIndex === this.activeIndex;
      const isComplete = this.sceneStates[SCENES[cardIndex].id].complete;
      card.classList.toggle("is-active", isActive);
      card.classList.toggle("is-complete", isComplete);
      card.setAttribute("aria-selected", String(isActive));
      card.querySelector("[data-mark]").textContent = isComplete ? "✓" : String(cardIndex + 1).padStart(2, "0");
    });

    const completed = this.completedCount();
    this.els.completeCount.textContent = completed;
    this.els.progressFill.style.width = `${completed / SCENES.length * 100}%`;
    this.els.progressLabel.textContent = completed === SCENES.length ? "三幕齐备" : `${completed} 幕已收录`;
    this.els.saveStatus.textContent = state.complete
      ? `已存档 · CH ${indexLabel} · 本机自动保存`
      : "参数将自动保存在本机";
    this.updateSaveButton();
    this.updateTimeUI();
  }

  completedCount() {
    return SCENES.reduce((count, scene) => count + (this.sceneStates[scene.id].complete ? 1 : 0), 0);
  }

  buildLayerControls() {
    const scene = this.scene;
    const state = this.state;
    this.els.layerControls.innerHTML = scene.layers.map((layer, index) => `
      <div class="layer-control" data-layer="${index}">
        <div class="layer-control-head">
          <span class="layer-name"><span class="layer-index">${String(index + 1).padStart(2, "0")}</span>${layer.name}</span>
          <output class="layer-angle" data-angle-output="${index}">${Math.round(state.angles[index])}°</output>
        </div>
        <input class="layer-slider" data-angle="${index}" type="range" min="-180" max="180" step="1"
          value="${state.angles[index]}" aria-label="旋转${layer.name}纸层">
        <div class="layer-spacing">
          <span>层距</span>
          <input class="spacing-slider" data-spacing="${index}" type="range" min="18" max="100" step="1"
            value="${state.spacings[index]}" aria-label="${layer.name}层间距">
          <span class="spacing-value" data-spacing-output="${index}">${Math.round(state.spacings[index])}</span>
        </div>
      </div>
    `).join("");

    this.els.layerControls.querySelectorAll("[data-angle]").forEach((slider) => {
      const index = Number(slider.dataset.angle);
      this.setRangeFill(slider);
      slider.addEventListener("input", () => {
        state.angles[index] = Number(slider.value);
        const output = this.els.layerControls.querySelector(`[data-angle-output="${index}"]`);
        output.textContent = `${slider.value}°`;
        this.setRangeFill(slider);
        this.audio.ratchet();
        this.changed();
      });
      slider.addEventListener("change", () => this.persistNow());
    });
    this.els.layerControls.querySelectorAll("[data-spacing]").forEach((slider) => {
      const index = Number(slider.dataset.spacing);
      this.setRangeFill(slider);
      slider.addEventListener("input", () => {
        state.spacings[index] = Number(slider.value);
        const output = this.els.layerControls.querySelector(`[data-spacing-output="${index}"]`);
        output.textContent = slider.value;
        this.setRangeFill(slider);
        this.audio.click(0.35);
        this.changed();
      });
      slider.addEventListener("change", () => this.persistNow());
    });
  }

  setRangeFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    input.style.setProperty("--fill", `${(value - min) / (max - min) * 100}%`);
  }

  setInspectorPanel(panelId) {
    this.els.tabs.forEach((tab) => {
      const active = tab.dataset.panel === panelId;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    this.els.panels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.id === panelId);
    });
  }

  applyLightPreset(preset) {
    const state = this.state;
    const values = {
      soft: { distance: 76, height: 50, x: 0.91 },
      dramatic: { distance: 55, height: 66, x: 0.87 },
      low: { distance: 67, height: 25, x: 0.94 },
    }[preset];
    if (!values) return;
    state.light.distance = values.distance;
    state.light.height = values.height;
    state.light.x = values.x;
    state.light.y = clamp(1 - values.height / 100 * 0.86 - 0.07, 0.08, 0.92);
    this.els.lightIntensity.value = values.distance;
    this.els.lightIntensityValue.textContent = values.distance;
    this.els.lightHeight.value = values.height;
    this.els.lightHeightValue.textContent = values.height;
    this.setRangeFill(this.els.lightIntensity);
    this.setRangeFill(this.els.lightHeight);
    this.els.presets.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.lightPreset === preset);
    });
    this.audio.sweep(1.2);
    this.changed(true);
  }

  changed(immediate = false) {
    this.scheduleMeasure(immediate ? 0 : 36);
    this.schedulePersist();
  }

  buildTimeline() {
    const scene = this.scene;
    const state = this.state;
    this.els.timelineLabels.innerHTML = scene.layers.map((layer, index) => `
      <div class="timeline-label"><span>${String(index + 1).padStart(2, "0")}</span><i></i><span>${layer.name}</span></div>
    `).join("");

    const tracks = scene.layers.map((layer, index) => {
      const fade = state.timeline[index];
      const left = fade.in / TOTAL_TIME * 100;
      const width = (fade.out - fade.in) / TOTAL_TIME * 100;
      return `
        <div class="track" data-track="${index}">
          <span class="track-line"></span>
          <span class="track-fade" data-fade="${index}" style="left:${left}%;width:${width}%"></span>
          <button class="keyframe" type="button" data-keyframe="${index}" data-edge="in"
            style="left:${left}%" aria-label="${layer.name}淡入关键帧"></button>
          <button class="keyframe is-out" type="button" data-keyframe="${index}" data-edge="out"
            style="left:${left + width}%" aria-label="${layer.name}淡出关键帧"></button>
        </div>
      `;
    }).join("");

    const ruler = [0, 2, 4, 6, 8].map((seconds) => (
      `<span>${String(seconds).padStart(2, "0")}s</span>`
    )).join("");
    this.els.timelineTracks.innerHTML = `
      <div class="timeline-ruler">${ruler}</div>
      ${tracks}
      <div class="playhead" id="playhead"><span></span></div>
    `;
    this.els.playhead = document.getElementById("playhead");
    this.updatePlayhead();
    this.updateTimeUI();
  }

  bindTimeline() {
    this.els.timelineTracks.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const keyframe = event.target.closest(".keyframe");
      if (keyframe) {
        event.preventDefault();
        this.beginKeyframeDrag(event, keyframe);
        return;
      }
      if (event.target.closest(".timeline-ruler")) return;
      event.preventDefault();
      this.beginScrub(event);
    });
  }

  timeFromPointer(clientX) {
    const rect = this.els.timelineTracks.getBoundingClientRect();
    const usable = rect.width - 28;
    return clamp((clientX - rect.left - 14) / usable, 0, 1) * TOTAL_TIME;
  }

  beginScrub(event) {
    this.playing = false;
    this.els.playButton.classList.remove("is-playing");
    this.els.timelineTracks.classList.add("is-scrubbing");
    const seek = (pointerEvent) => {
      this.state.currentTime = this.timeFromPointer(pointerEvent.clientX);
      this.updatePlayhead();
      this.updateTimeUI();
      this.scheduleMeasure(0);
    };
    seek(event);
    this.audio.click(0.25);
    const finish = () => {
      this.els.timelineTracks.classList.remove("is-scrubbing");
      window.removeEventListener("pointermove", seek);
      window.removeEventListener("pointerup", finish);
      this.schedulePersist();
    };
    window.addEventListener("pointermove", seek);
    window.addEventListener("pointerup", finish, { once: true });
  }

  beginKeyframeDrag(event, keyframe) {
    const layerIndex = Number(keyframe.dataset.keyframe);
    const edge = keyframe.dataset.edge;
    const fade = this.state.timeline[layerIndex];
    keyframe.classList.add("is-dragging");
    this.els.timelineTracks.classList.add("is-tracking");
    const move = (pointerEvent) => {
      const time = this.timeFromPointer(pointerEvent.clientX);
      if (edge === "in") fade.in = clamp(time, 0, fade.out - 0.3);
      else fade.out = clamp(time, fade.in + 0.3, TOTAL_TIME);
      this.updateTrack(layerIndex);
      this.audio.click(0.34);
      this.scheduleMeasure(0);
    };
    const finish = () => {
      keyframe.classList.remove("is-dragging");
      this.els.timelineTracks.classList.remove("is-tracking");
      window.removeEventListener("pointermove", move);
      this.schedulePersist();
      this.measureNow();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  }

  updateTrack(index) {
    const fade = this.state.timeline[index];
    const track = this.els.timelineTracks.querySelector(`[data-track="${index}"]`);
    if (!track) return;
    const fadeBar = track.querySelector(`[data-fade="${index}"]`);
    const inHandle = track.querySelector('[data-edge="in"]');
    const outHandle = track.querySelector('[data-edge="out"]');
    fadeBar.style.left = `${fade.in / TOTAL_TIME * 100}%`;
    fadeBar.style.width = `${(fade.out - fade.in) / TOTAL_TIME * 100}%`;
    inHandle.style.left = `${fade.in / TOTAL_TIME * 100}%`;
    outHandle.style.left = `${fade.out / TOTAL_TIME * 100}%`;
  }

  resetTimeline() {
    const defaults = createSceneState(this.scene).timeline;
    this.state.timeline = defaults;
    this.buildTimeline();
    this.audio.ratchet();
    this.changed(true);
    this.showToast("本幕时间线已恢复默认编排");
  }

  togglePlayback() {
    this.playing = !this.playing;
    if (this.playing && this.state.currentTime >= TOTAL_TIME - 0.01) {
      this.state.currentTime = 0;
    }
    this.els.playButton.classList.toggle("is-playing", this.playing);
    this.els.playButton.setAttribute("aria-label", this.playing ? "暂停" : "播放");
    this.audio.click(0.55);
  }

  toggleSound() {
    const enabled = this.els.soundButton.getAttribute("aria-pressed") !== "true";
    this.audio.setEnabled(enabled);
    this.els.soundButton.setAttribute("aria-pressed", String(enabled));
    this.els.soundButton.querySelector("span").textContent = enabled ? "机械声 开" : "机械声 关";
    if (enabled) this.audio.click(0.45);
  }

  bindCanvasLight() {
    const updateFromPointer = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      this.state.light.x = clamp(x, 0.76, 0.97);
      this.state.light.y = clamp(y, 0.08, 0.92);
      const height = Math.round(clamp((1 - this.state.light.y - 0.07) / 0.86 * 100, 12, 88));
      this.state.light.height = height;
      this.els.lightHeight.value = height;
      this.els.lightHeightValue.textContent = height;
      this.setRangeFill(this.els.lightHeight);
      this.els.dragHint.classList.add("is-hidden");
      this.audio.sweep(0.8);
      this.scheduleMeasure(20);
    };
    this.els.canvasFrame.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.dragging = true;
      this.els.canvasFrame.style.cursor = "grabbing";
      this.audio.ensureContext();
      updateFromPointer(event);
      const move = (pointerEvent) => {
        if (this.dragging) updateFromPointer(pointerEvent);
      };
      const finish = () => {
        this.dragging = false;
        this.els.canvasFrame.style.cursor = "crosshair";
        window.removeEventListener("pointermove", move);
        this.schedulePersist();
        this.measureNow();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish, { once: true });
    });
  }

  scheduleMeasure(delay = 36) {
    window.clearTimeout(this.measureTimer);
    this.measureTimer = window.setTimeout(() => this.measureNow(), delay);
  }

  measureNow() {
    this.renderer.resize();
    this.metrics = this.renderer.measure(this.state, this.scene, this.state.currentTime);
    this.state.metrics = this.metrics;
    this.lastMeasure = performance.now();
    this.updateMetricsUI();
  }

  updateMetricsUI() {
    const metrics = this.metrics;
    if (!metrics) return;
    const silhouette = metrics.silhouette;
    const burn = metrics.burn;
    this.els.silhouetteValue.textContent = `${silhouette}%`;
    this.els.silhouetteMeter.style.width = `${silhouette}%`;
    this.els.silhouetteMeter.style.background = silhouette < 60
      ? "linear-gradient(90deg, #8f523c, #df7b55)"
      : "linear-gradient(90deg, #9d7b52, #e3a45f)";
    this.els.exposureValue.textContent = burn > 0 ? `过曝 ${burn}%` : "安全";
    this.els.exposureMeter.style.width = `${metrics.exposure}%`;
    this.els.exposureMeter.classList.toggle("is-danger", burn > 0);
    this.els.stageState.classList.toggle("is-burning", burn > 0);
    this.els.stageState.querySelector("span:last-child").textContent = burn > 0
      ? "边缘过曝"
      : (this.state.complete ? "已收录" : "实时投影");
    this.els.burnCallout.classList.toggle("is-visible", burn > 0);

    let warning = "";
    let warn = false;
    if (burn > 0) {
      warning = "光源过近：边缘开始烧焦，把光源退后一些。";
      warn = true;
    } else if (silhouette < 60) {
      warning = "叠影过密：旋转纸层或调整间距，让轮廓重新透气。";
      warn = true;
    } else if (metrics.activeLayers < 4) {
      warning = "有纸层正在淡出；把播放头移到编排中段再收录。";
      warn = true;
    } else {
      warning = "构图透气，轮廓清楚，可收录这一幕。";
    }
    this.els.warningText.textContent = warning;
    this.els.warningNote.classList.toggle("is-warn", warn);

    this.els.diagnosticStrip.innerHTML = `
      <span class="diag ${silhouette < 60 ? "warn" : ""}">叠影 ${metrics.overlap}%</span>
      <span class="diag ${burn > 0 ? "warn" : ""}">${burn > 0 ? "边缘过曝" : "曝光安全"}</span>
      <span class="diag ${metrics.activeLayers < 4 ? "warn" : ""}">${metrics.activeLayers}/4 层可见</span>
    `;
    this.updateSaveButton();
  }

  isReady() {
    if (!this.metrics) return false;
    return this.metrics.silhouette >= 60
      && this.metrics.burn === 0
      && this.metrics.activeLayers === 4;
  }

  updateSaveButton() {
    const complete = this.state.complete;
    const ready = this.isReady();
    this.els.saveSceneButton.classList.toggle("is-complete", complete);
    this.els.saveSceneButton.classList.toggle("is-blocked", !ready && !complete);
    if (complete) {
      this.els.saveSceneLabel.textContent = "已收录 · 更新参数";
    } else if (ready) {
      this.els.saveSceneLabel.textContent = "收录这一幕";
    } else {
      this.els.saveSceneLabel.textContent = "调整构图后收录";
    }
  }

  saveCurrentScene() {
    this.measureNow();
    if (!this.isReady()) {
      const reason = this.metrics?.burn > 0
        ? "光源过近，边缘已经过曝。"
        : "轮廓还不够透气，请旋转纸层或拉开层距。";
      this.showToast(`暂未收录 · ${reason}`);
      this.audio.click(0.3);
      return false;
    }
    this.state.complete = true;
    this.state.savedAt = new Date().toISOString();
    this.persistNow();
    this.updateSceneChrome();
    const indexLabel = String(this.activeIndex + 1).padStart(2, "0");
    this.showToast(`CH ${indexLabel} 已收录 · 投影参数已存档`);
    this.audio.latch();
    return true;
  }

  resetCurrentScene() {
    const defaults = createSceneState(this.scene);
    this.sceneStates[this.scene.id] = defaults;
    this.buildLayerControls();
    this.buildTimeline();
    this.updateSceneChrome();
    this.changed(true);
    this.showToast("本幕投影参数已复位");
  }

  updateTimeUI() {
    const time = this.state.currentTime;
    const frames = Math.floor((time % 1) * 24);
    const seconds = Math.floor(time) % 60;
    const minutes = Math.floor(time / 60);
    this.els.timecode.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
    this.updatePlayhead();
  }

  updatePlayhead() {
    if (!this.els.playhead) return;
    const tracks = this.els.timelineTracks;
    const usable = Math.max(1, tracks.clientWidth - 28);
    const left = 14 + clamp(this.state.currentTime / TOTAL_TIME, 0, 1) * usable;
    this.els.playhead.style.left = `${left}px`;
  }

  persistNow() {
    window.clearTimeout(this.persistTimer);
    try {
      const scenes = {};
      for (const scene of SCENES) {
        const snapshot = deepClone(this.sceneStates[scene.id]);
        delete snapshot.metrics;
        scenes[scene.id] = snapshot;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        activeIndex: this.activeIndex,
        scenes,
      }));
    } catch {
      this.els.saveStatus.textContent = "本机存档不可用，请导出当前帧";
    }
  }

  schedulePersist() {
    window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => this.persistNow(), 260);
  }

  showToast(message) {
    this.els.toastText.textContent = message;
    this.els.toast.classList.add("is-visible");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.els.toast.classList.remove("is-visible");
    }, 2800);
  }

  async exportFrame() {
    this.playing = false;
    this.els.playButton.classList.remove("is-playing");
    this.measureNow();
    this.persistNow();
    this.renderer.render(this.state, this.scene, this.state.currentTime, performance.now());
    this.audio.shutter();
    this.els.exportFlash.classList.remove("is-active");
    void this.els.exportFlash.offsetWidth;
    this.els.exportFlash.classList.add("is-active");

    const blob = await this.renderer.toBlob();
    if (!blob) {
      this.showToast("导出失败 · 浏览器未能生成图像");
      return false;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `shadowbox-${this.scene.id}-${timestamp}.png`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    document.body.dataset.lastExport = filename;
    document.body.dataset.lastExportAt = new Date().toISOString();
    const completed = this.completedCount();
    this.showToast(completed === SCENES.length
      ? "交付完成 · 当前帧与三幕参数已保存"
      : `当前帧已导出 · 仍有 ${SCENES.length - completed} 幕未收录`);
    return true;
  }

  loop(now) {
    const delta = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    if (this.playing) {
      this.state.currentTime += delta;
      if (this.state.currentTime >= TOTAL_TIME) {
        this.state.currentTime = 0;
        this.audio.click(0.28);
      }
      this.updateTimeUI();
      if (now - this.lastMeasure > 145) {
        this.measureNow();
      }
      if (now - this.lastAudioTick > 940 && this.audio.context && this.audio.enabled) {
        this.lastAudioTick = now;
        this.audio.click(0.18);
      }
    }
    this.renderer.render(this.state, this.scene, this.state.currentTime, now);

    this.fpsFrames += 1;
    if (now - this.fpsStarted > 900) {
      const fps = Math.round(this.fpsFrames / ((now - this.fpsStarted) / 1000));
      this.els.fpsReadout.textContent = clamp(fps, 1, 99);
      this.fpsFrames = 0;
      this.fpsStarted = now;
    }
    requestAnimationFrame((nextNow) => this.loop(nextNow));
  }

  exposeTestApi() {
    window.shadowBox = {
      getState: () => ({
        activeIndex: this.activeIndex,
        activeScene: this.scene.id,
        time: this.state.currentTime,
        metrics: this.metrics ? { ...this.metrics } : null,
        scenes: deepClone(this.sceneStates),
      }),
      getMetrics: () => (this.metrics ? { ...this.metrics } : null),
      switchScene: (index) => this.activateScene(index),
      saveScene: () => this.saveCurrentScene(),
      exportFrame: () => this.exportFrame(),
      setLayer: (index, values = {}) => {
        if (Number.isFinite(values.angle)) this.state.angles[index] = clamp(values.angle, -180, 180);
        if (Number.isFinite(values.spacing)) this.state.spacings[index] = clamp(values.spacing, 18, 100);
        this.buildLayerControls();
        this.changed(true);
      },
      setLight: (values = {}) => {
        if (Number.isFinite(values.distance)) this.state.light.distance = clamp(values.distance, 12, 100);
        if (Number.isFinite(values.height)) this.state.light.height = clamp(values.height, 12, 88);
        if (Number.isFinite(values.x)) this.state.light.x = clamp(values.x, 0.76, 0.97);
        if (Number.isFinite(values.y)) this.state.light.y = clamp(values.y, 0.08, 0.92);
        this.updateSceneChrome();
        this.changed(true);
      },
      setTime: (time) => {
        this.state.currentTime = clamp(time, 0, TOTAL_TIME);
        this.updateTimeUI();
        this.measureNow();
      },
      resetScene: () => this.resetCurrentScene(),
      storageKey: STORAGE_KEY,
    };
    window.__shadowboxReady = true;
    document.body.dataset.ready = "true";
  }
}

new ShadowBoxApp();
