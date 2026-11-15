import {
  AXES,
  AXIS_META,
  EASING_PRESETS,
  clamp,
  clone,
  createSampleProject,
  findSegmentIndex,
  formatSeconds,
  formatTimecode,
  frameGeometry,
  getBoundsViolation,
  keyframeNear,
  normalizeEasing,
  normalizeProject,
  projectFingerprint,
  projectToJSON,
  sampleValues,
  verifyRestoration,
} from "./engine.js";
import { StageRenderer } from "./canvas.js";

const STORAGE_KEY = "cutline.shot08.project.v1";
const VERIFY_KEY = "cutline.shot08.verify.v1";
const DEFAULT_EASING = {
  position: [0.42, 0, 0.2, 1],
  scale: [0.3, 0, 0.22, 1],
  rotation: [0.36, 0, 0.18, 1],
  focus: [0.42, 0, 0.26, 1],
};

const state = {
  project: null,
  time: 0,
  playing: false,
  selectedAxis: "position",
  selectedSegment: 0,
  violation: null,
  savedFingerprint: null,
  rafId: null,
  lastTimestamp: 0,
  curveDrag: null,
  scrubbing: false,
  lastViolationSignature: "",
};

const els = {};
const renderer = new StageRenderer(
  document.getElementById("stageCanvas"),
  document.getElementById("canvasShell"),
);

const audio = {
  context: null,
  timer: null,
};

function cacheElements() {
  [
    "saveState", "loadSampleBtn", "checkBoundsBtn", "reloadBtn", "exportBtn",
    "fitViewBtn", "canvasShell", "canvasStatus", "boundaryNotice", "boundaryDetail",
    "toStartBtn", "prevKeyBtn", "playBtn", "playIcon", "nextKeyBtn", "toEndBtn",
    "currentTimecode", "loopToggle", "zoomReadout", "inspectorTime", "addKeyBtn",
    "positionX", "positionY", "scaleRange", "scaleValue", "rotationRange",
    "rotationValue", "focusX", "focusY", "positionSummary", "scaleSummary",
    "rotationSummary", "focusSummary", "curveSegment", "axisTabs", "curveEditor",
    "curveSvg", "curveArea", "handleLine1", "handleLine2", "curvePath",
    "handle1", "handle2", "curveProgress", "curveP1", "curveP2", "beatToggle",
    "bpmInput", "boundaryPill", "deleteKeyBtn", "saveBtn", "timelineGrid",
    "rulerRow", "beatRow", "playhead", "playheadTime", "timelineCursor",
    "trackPosition", "trackScale", "trackRotation", "trackFocus",
    "statusMessage", "fpsReadout", "boundsReadout", "toastStack",
    "verifyDialog", "verifyList", "verifySummary", "closeDialogBtn", "dialogDoneBtn",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
  els.trackRows = [...document.querySelectorAll(".track-row")];
  els.axisTabs = [...document.querySelectorAll(".axis-tab")];
  els.presetButtons = [...document.querySelectorAll(".preset-row button")];
}

function boot() {
  cacheElements();
  const stored = readStorage();
  state.project = stored || createSampleProject();
  state.savedFingerprint = projectFingerprint(state.project);
  state.violation = getBoundsViolation(state.project);
  els.beatToggle.checked = Boolean(state.project.sound.enabled);
  els.bpmInput.value = String(state.project.sound.bpm || 96);
  if (!stored) {
    try {
      localStorage.setItem(STORAGE_KEY, projectToJSON(state.project));
    } catch (error) {
      console.warn("Unable to initialize local project.", error);
    }
  }

  renderer.setData(state.project, 0, state.violation, false);
  renderer.onPositionDrag = (point) => {
    updateValues((values) => {
      values.position.x = clamp(point.x, 0, state.project.stage.width);
      values.position.y = clamp(point.y, 0, state.project.stage.height);
    }, { source: "position" });
  };
  renderer.onPositionDragEnd = () => {
    els.statusMessage.textContent = `取景框位置已记录于 ${formatSeconds(state.time)}`;
  };
  bindTransport();
  bindTimeline();
  bindInspector();
  bindCurveEditor();
  bindActions();
  bindKeyboard();
  renderTimeline();
  renderLive();
  rendererNotice();
  updateSaveState();
  runPendingReloadVerification();
  if (state.violation) {
    els.statusMessage.textContent = "载入工程存在越界路径 · 保存被阻止";
  }
  window.setTimeout(() => renderer.resize(), 80);
}

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeProject(JSON.parse(raw)) : null;
  } catch (error) {
    console.warn("Local project could not be restored.", error);
    return null;
  }
}

function currentValues() {
  return sampleValues(state.project, state.time);
}

function setProjectTime(time, { stop = false } = {}) {
  if (stop && state.playing) pausePlayback();
  state.time = clamp(time, 0, state.project.duration);
  state.selectedSegment = segmentForTime(state.time);
  renderLive();
}

function segmentForTime(time) {
  const keys = state.project.keyframes;
  if (time >= state.project.duration) return Math.max(0, keys.length - 2);
  return findSegmentIndex(state.project, time);
}

function renderLive() {
  if (!state.project) return;
  const values = currentValues();
  renderer.setData(state.project, state.time, state.violation, state.playing);
  els.currentTimecode.textContent = formatTimecode(state.time, state.project.fps);
  els.inspectorTime.textContent = formatTimecode(state.time, state.project.fps);
  els.playheadTime.textContent = formatSeconds(state.time);
  const percent = (state.time / state.project.duration) * 100;
  els.playhead.style.left = `${percent}%`;
  els.timelineCursor.style.left = `${percent}%`;
  els.positionSummary.textContent = `${Math.round(values.position.x)}, ${Math.round(values.position.y)}`;
  els.scaleSummary.textContent = `${Math.round(values.scale * 100)}%`;
  els.rotationSummary.textContent = `${values.rotation.toFixed(1)}°`;
  els.focusSummary.textContent = `${Math.round(values.focus.x)}%, ${Math.round(values.focus.y)}%`;
  els.trackPosition.textContent = `${Math.round(values.position.x)}, ${Math.round(values.position.y)}`;
  els.trackScale.textContent = `${values.scale.toFixed(2)}×`;
  els.trackRotation.textContent = `${values.rotation.toFixed(1)}°`;
  els.trackFocus.textContent = `${Math.round(values.focus.x)}%, ${Math.round(values.focus.y)}%`;
  els.zoomReadout.textContent = `${Math.round((renderer.displayWidth / state.project.stage.width) * 100)}%`;
  syncInspector(values);
  renderCurveProgress();
  markCurrentKeys();
}

function syncInspector(values) {
  setInputValue(els.positionX, values.position.x.toFixed(0));
  setInputValue(els.positionY, values.position.y.toFixed(0));
  setInputValue(els.scaleRange, values.scale.toFixed(2));
  setInputValue(els.scaleValue, values.scale.toFixed(2));
  setInputValue(els.rotationRange, values.rotation.toFixed(1));
  setInputValue(els.rotationValue, values.rotation.toFixed(1));
  setInputValue(els.focusX, values.focus.x.toFixed(0));
  setInputValue(els.focusY, values.focus.y.toFixed(0));
}

function setInputValue(input, value) {
  if (document.activeElement === input) return;
  if (input.value !== value) input.value = value;
}

function markCurrentKeys() {
  els.trackRows.forEach((row) => {
    row.querySelectorAll(".key-diamond").forEach((marker) => {
      const active = Math.abs(Number(marker.dataset.time) - state.time) <= 0.06;
      marker.classList.toggle("is-current", active);
    });
  });
  const near = keyframeNear(state.project, state.time);
  els.addKeyBtn.disabled = near >= 0;
}

function rendererNotice() {
  const violation = state.violation;
  const noticeVisible = Boolean(violation);
  els.boundaryNotice.hidden = !noticeVisible;
  if (violation) {
    const timeText = `${violation.time.toFixed(1)}s`;
    els.boundaryDetail.textContent = `${timeText} · 取景框越过舞台${violation.side}边界 ${violation.overshoot.toFixed(0)}px`;
    els.canvasStatus.textContent = "OUT OF BOUNDS";
    els.canvasStatus.classList.add("is-danger");
    els.boundaryPill.innerHTML = "<i></i>路径越界";
    els.boundaryPill.classList.add("is-danger");
    els.boundsReadout.textContent = "BOUNDS FAIL";
    els.boundsReadout.classList.add("is-danger");
  } else {
    els.canvasStatus.textContent = "SAFE";
    els.canvasStatus.classList.remove("is-danger");
    els.boundaryPill.innerHTML = "<i></i>路径安全";
    els.boundaryPill.classList.remove("is-danger");
    els.boundsReadout.textContent = "BOUNDS OK";
    els.boundsReadout.classList.remove("is-danger");
  }
  const blocked = Boolean(violation);
  els.saveBtn.disabled = blocked;
  els.exportBtn.disabled = blocked;
  els.saveBtn.classList.toggle("is-disabled", blocked);
  els.exportBtn.classList.toggle("is-disabled", blocked);
  els.exportBtn.title = blocked ? "请先修正取景框越界" : "导出 JSON 工程";
}

function validateBounds({ notify = false } = {}) {
  state.violation = getBoundsViolation(state.project);
  rendererNotice();
  const signature = state.violation
    ? `${state.violation.side}:${state.violation.time.toFixed(2)}:${Math.round(state.violation.overshoot)}`
    : "";
  if (notify && state.violation && signature !== state.lastViolationSignature) {
    showToast(
      "danger",
      "路径越界，保存已阻止",
      `${state.violation.time.toFixed(1)}s 处取景框越过${state.violation.side}边界，请调整位置或缩放。`,
      5200,
    );
  }
  state.lastViolationSignature = signature;
  return state.violation;
}

function markDirty() {
  updateSaveState();
  els.statusMessage.textContent = state.violation
    ? "存在越界路径 · 保存被阻止"
    : "工程有未保存更改";
}

function updateSaveState() {
  const dirty = projectFingerprint(state.project) !== state.savedFingerprint;
  els.saveState.textContent = dirty ? "未保存" : "已保存";
  els.saveState.classList.toggle("is-dirty", dirty);
}

function commitCurrentValues(values, { notify = true } = {}) {
  const keys = state.project.keyframes;
  let index = keyframeNear(state.project, state.time, 0.045);
  let inserted = false;
  if (index < 0) {
    const previous = keys[Math.max(0, findSegmentIndex(state.project, state.time))];
    const easing = {};
    AXES.forEach((axis) => {
      easing[axis] = normalizeEasing(previous?.easing?.[axis] || DEFAULT_EASING[axis], axis);
    });
    keys.push({
      time: Number(state.time.toFixed(3)),
      values: clone(values),
      easing,
    });
    keys.sort((a, b) => a.time - b.time);
    index = keys.findIndex((key) => Math.abs(key.time - state.time) <= 0.001);
    inserted = true;
  } else {
    keys[index].values = clone(values);
  }
  state.selectedSegment = segmentForTime(state.time);
  validateBounds({ notify });
  markDirty();
  if (inserted) renderTimeline();
  renderLive();
  renderCurveEditor();
}

function showToast(kind, title, detail = "", timeout = 3200) {
  while (els.toastStack.children.length >= 3) {
    els.toastStack.firstElementChild.remove();
  }
  const toast = document.createElement("div");
  toast.className = `toast is-${kind}`;
  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.textContent = kind === "danger" ? "!" : kind === "success" ? "✓" : "i";
  const copy = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  const message = document.createElement("span");
  message.textContent = detail;
  copy.append(heading);
  if (detail) copy.append(message);
  toast.append(icon, copy);
  els.toastStack.append(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 190);
  }, timeout);
}

function renderTimeline() {
  const { duration, fps, keyframes, sound } = state.project;
  els.rulerRow.replaceChildren();
  const subdivisions = Math.round(duration * 4);
  for (let i = 0; i <= subdivisions; i += 1) {
    const time = (i / subdivisions) * duration;
    const major = i % 4 === 0;
    const tick = document.createElement("span");
    tick.className = `ruler-tick ${major ? "major" : "minor"}`;
    tick.style.left = `${(time / duration) * 100}%`;
    if (major) {
      tick.textContent = `${time.toFixed(0)}s`;
    }
    els.rulerRow.append(tick);
  }

  els.trackRows.forEach((row) => {
    row.replaceChildren();
    keyframes.forEach((key, index) => {
      if (index < keyframes.length - 1) {
        const next = keyframes[index + 1];
        const line = document.createElement("span");
        line.className = "segment-line";
        line.style.left = `${(key.time / duration) * 100}%`;
        line.style.width = `${((next.time - key.time) / duration) * 100}%`;
        if (state.violation) line.classList.add("is-invalid");
        row.append(line);
      }
      const marker = document.createElement("span");
      marker.className = "key-diamond";
      marker.style.left = `${(key.time / duration) * 100}%`;
      marker.dataset.time = String(key.time);
      marker.dataset.index = String(index);
      marker.tabIndex = 0;
      marker.setAttribute("role", "button");
      marker.setAttribute("aria-label", `${AXIS_META[row.dataset.track].label}关键帧 ${index + 1}，${formatSeconds(key.time)}`);
      marker.title = `K${String(index + 1).padStart(2, "0")} · ${formatSeconds(key.time)}`;
      marker.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        setProjectTime(key.time, { stop: true });
        renderCurveEditor();
      });
      marker.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setProjectTime(key.time, { stop: true });
          renderCurveEditor();
        }
      });
      row.append(marker);
    });
  });

  els.beatRow.replaceChildren();
  const bpm = clamp(Number(sound.bpm) || 96, 40, 220);
  const beatCount = Math.ceil((duration * bpm) / 60);
  for (let i = 0; i <= beatCount; i += 1) {
    const time = (i * 60) / bpm;
    if (time > duration + 0.001) break;
    const mark = document.createElement("span");
    mark.className = `beat-mark${i % 4 === 0 ? " is-downbeat" : ""}`;
    mark.style.left = `${(time / duration) * 100}%`;
    els.beatRow.append(mark);
  }

  const meta = document.querySelector(".timeline-meta");
  meta.textContent = `${duration.toFixed(1)}s · ${fps}fps · ${keyframes.length} keys`;
  els.fpsReadout.textContent = `${fps} FPS`;
  renderCurveEditor();
  markCurrentKeys();
}

function bindTimeline() {
  els.timelineGrid.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".key-diamond")) return;
    state.scrubbing = true;
    pausePlayback();
    els.timelineGrid.setPointerCapture(event.pointerId);
    scrubTo(event);
  });
  els.timelineGrid.addEventListener("pointermove", (event) => {
    if (state.scrubbing) scrubTo(event);
  });
  const finishScrub = () => {
    state.scrubbing = false;
  };
  els.timelineGrid.addEventListener("pointerup", finishScrub);
  els.timelineGrid.addEventListener("pointercancel", finishScrub);
}

function scrubTo(event) {
  const rect = els.timelineGrid.getBoundingClientRect();
  const progress = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  setProjectTime(progress * state.project.duration);
  renderCurveEditor();
}

function bindTransport() {
  els.playBtn.addEventListener("click", togglePlayback);
  els.toStartBtn.addEventListener("click", () => {
    pausePlayback();
    setProjectTime(0);
    renderCurveEditor();
  });
  els.toEndBtn.addEventListener("click", () => {
    pausePlayback();
    setProjectTime(state.project.duration);
    renderCurveEditor();
  });
  els.prevKeyBtn.addEventListener("click", () => jumpToKey(-1));
  els.nextKeyBtn.addEventListener("click", () => jumpToKey(1));
  els.fitViewBtn.addEventListener("click", () => renderer.resize());
  els.loopToggle.addEventListener("change", () => {
    els.statusMessage.textContent = els.loopToggle.checked ? "循环播放已启用" : "循环播放已关闭";
  });
}

function togglePlayback() {
  if (state.playing) pausePlayback();
  else startPlayback();
}

function startPlayback() {
  if (state.playing) return;
  if (state.time >= state.project.duration) state.time = 0;
  validateBounds({ notify: true });
  state.playing = true;
  els.canvasShell.classList.add("is-playing");
  syncPlayButton();
  state.lastTimestamp = performance.now();
  startBeatClock();
  state.rafId = requestAnimationFrame(playbackTick);
}

function pausePlayback() {
  if (!state.playing) return;
  state.playing = false;
  cancelAnimationFrame(state.rafId);
  state.rafId = null;
  els.canvasShell.classList.remove("is-playing");
  syncPlayButton();
  stopBeatClock();
  renderLive();
}

function playbackTick(timestamp) {
  if (!state.playing) return;
  const delta = Math.min(0.06, Math.max(0, (timestamp - state.lastTimestamp) / 1000));
  state.lastTimestamp = timestamp;
  let next = state.time + delta;
  if (next >= state.project.duration) {
    if (els.loopToggle.checked) {
      next %= state.project.duration;
      state.selectedSegment = segmentForTime(next);
    } else {
      state.time = state.project.duration;
      pausePlayback();
      renderCurveEditor();
      return;
    }
  }
  state.time = next;
  state.selectedSegment = segmentForTime(next);
  renderLive();
  state.rafId = requestAnimationFrame(playbackTick);
}

function syncPlayButton() {
  els.playBtn.setAttribute("aria-label", state.playing ? "暂停" : "播放");
  els.playIcon.setAttribute(
    "d",
    state.playing ? "M6 4h4v16H6zM14 4h4v16h-4z" : "M7 4.5 19 12 7 19.5Z",
  );
}

function jumpToKey(direction) {
  pausePlayback();
  const candidates = state.project.keyframes
    .filter((key) => (direction < 0 ? key.time < state.time - 0.02 : key.time > state.time + 0.02))
    .sort((a, b) => a.time - b.time);
  const target = direction < 0 ? candidates[candidates.length - 1] : candidates[0];
  state.time = target ? target.time : direction < 0 ? 0 : state.project.duration;
  state.selectedSegment = segmentForTime(state.time);
  renderLive();
  renderCurveEditor();
}

function addKeyframe() {
  pausePlayback();
  const existing = keyframeNear(state.project, state.time, 0.045);
  if (existing >= 0) {
    showToast("info", "此处已有关键帧", "可直接修改四轴数值，或拖动缓动曲线。");
    return;
  }
  const values = currentValues();
  commitCurrentValues(values, { notify: true });
  showToast("success", "已添加四轴关键帧", `${formatSeconds(state.time)} · 位置 / 缩放 / 旋转 / 焦点`);
  els.statusMessage.textContent = `关键帧已记录于 ${formatSeconds(state.time)}`;
}

function deleteKeyframe() {
  if (state.project.keyframes.length <= 2) {
    showToast("danger", "无法删除关键帧", "镜头至少需要保留开始与结束两个关键帧。");
    return;
  }
  const index = keyframeNear(state.project, state.time, 0.08);
  if (index < 0) {
    showToast("info", "当前时间没有关键帧", "请先把播放头移到菱形标记上。");
    return;
  }
  state.project.keyframes.splice(index, 1);
  state.time = Math.min(state.time, state.project.duration);
  state.selectedSegment = segmentForTime(state.time);
  markDirty();
  validateBounds({ notify: true });
  renderTimeline();
  renderLive();
  showToast("success", "关键帧已删除", `已移除 K${String(index + 1).padStart(2, "0")}`);
}

function startBeatClock() {
  stopBeatClock();
  if (!els.beatToggle.checked) return;
  const bpm = clamp(Number(els.bpmInput.value) || state.project.sound.bpm, 40, 220);
  const period = (60 / bpm) * 1000;
  try {
    audio.context = audio.context || new AudioContext();
    audio.context.resume();
  } catch (error) {
    return;
  }
  playBeatClick(true);
  audio.timer = window.setInterval(() => playBeatClick(false), period);
}

function playBeatClick(accent) {
  if (!audio.context || audio.context.state !== "running") return;
  const oscillator = audio.context.createOscillator();
  const gain = audio.context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = accent ? 210 : 145;
  gain.gain.setValueAtTime(0.0001, audio.context.currentTime);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.035 : 0.018, audio.context.currentTime + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.context.currentTime + 0.055);
  oscillator.connect(gain).connect(audio.context.destination);
  oscillator.start();
  oscillator.stop(audio.context.currentTime + 0.06);
}

function stopBeatClock() {
  if (audio.timer) window.clearInterval(audio.timer);
  audio.timer = null;
}

function renderCurveEditor() {
  if (!state.project) return;
  const index = clamp(state.selectedSegment, 0, state.project.keyframes.length - 2);
  const from = state.project.keyframes[index];
  const to = state.project.keyframes[index + 1];
  if (!from || !to) return;
  state.selectedSegment = index;
  const axis = state.selectedAxis;
  const easing = normalizeEasing(from.easing?.[axis], axis);
  const color = AXIS_META[axis].color;
  els.curveEditor.style.setProperty("--axis-color", color);
  els.curveSvg.style.setProperty("--axis-color", color);
  els.axisTabs.forEach((tab) => {
    const active = tab.dataset.axis === axis;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  els.curveSegment.textContent = `${from.time.toFixed(1)}s → ${to.time.toFixed(1)}s`;
  els.curveP1.textContent = `${easing[0].toFixed(2)}, ${easing[1].toFixed(2)}`;
  els.curveP2.textContent = `${easing[2].toFixed(2)}, ${easing[3].toFixed(2)}`;

  const p1 = curvePoint(easing[0], easing[1]);
  const p2 = curvePoint(easing[2], easing[3]);
  els.curvePath.setAttribute("d", `M 24 148 C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, 296 16`);
  els.curveArea.setAttribute("d", `M 24 148 C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, 296 16 L 296 148 Z`);
  els.handle1.setAttribute("cx", p1.x);
  els.handle1.setAttribute("cy", p1.y);
  els.handle2.setAttribute("cx", p2.x);
  els.handle2.setAttribute("cy", p2.y);
  els.handleLine1.setAttribute("x2", p1.x);
  els.handleLine1.setAttribute("y2", p1.y);
  els.handleLine2.setAttribute("x2", p2.x);
  els.handleLine2.setAttribute("y2", p2.y);
  renderCurveProgress();
}

function curvePoint(nx, ny) {
  return { x: 24 + nx * 272, y: 148 - ny * 132 };
}

function renderCurveProgress() {
  if (!state.project) return;
  const index = clamp(state.selectedSegment, 0, state.project.keyframes.length - 2);
  const from = state.project.keyframes[index];
  const to = state.project.keyframes[index + 1];
  if (!from || !to) return;
  const span = Math.max(0.00001, to.time - from.time);
  const progress = clamp((state.time - from.time) / span, 0, 1);
  const easing = normalizeEasing(from.easing?.[state.selectedAxis], state.selectedAxis);
  const eased = bezierSample(progress, easing);
  const point = curvePoint(progress, eased);
  els.curveProgress.setAttribute("cx", point.x);
  els.curveProgress.setAttribute("cy", point.y);
}

function bezierSample(progress, easing) {
  let low = 0;
  let high = 1;
  let t = progress;
  for (let i = 0; i < 12; i += 1) {
    const x = 3 * (1 - t) ** 2 * t * easing[0] + 3 * (1 - t) * t ** 2 * easing[2] + t ** 3;
    if (Math.abs(x - progress) < 0.00003) break;
    if (x < progress) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return 3 * (1 - t) ** 2 * t * easing[1] + 3 * (1 - t) * t ** 2 * easing[3] + t ** 3;
}

function bindCurveEditor() {
  els.axisTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.selectedAxis = tab.dataset.axis;
      renderCurveEditor();
    });
  });

  els.presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const curve = EASING_PRESETS[button.dataset.preset];
      if (!curve) return;
      const from = state.project.keyframes[state.selectedSegment];
      if (!from) return;
      from.easing[state.selectedAxis] = [...curve];
      validateBounds({ notify: true });
      markDirty();
      renderLive();
      renderCurveEditor();
      showToast("success", "缓动曲线已更新", `${AXIS_META[state.selectedAxis].label} · ${button.textContent}`);
    });
  });

  els.curveSvg.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".curve-handle");
    if (!handle) return;
    event.preventDefault();
    els.curveSvg.setPointerCapture(event.pointerId);
    state.curveDrag = {
      pointerId: event.pointerId,
      handle: Number(handle.dataset.handle),
    };
    handle.classList.add("is-active");
  });

  els.curveSvg.addEventListener("pointermove", (event) => {
    if (!state.curveDrag || event.pointerId !== state.curveDrag.pointerId) return;
    const point = clientToSvg(event);
    const nx = clamp((point.x - 24) / 272, 0, 1);
    const ny = clamp((148 - point.y) / 132, -0.35, 1.35);
    const from = state.project.keyframes[state.selectedSegment];
    if (!from) return;
    const easing = normalizeEasing(from.easing[state.selectedAxis], state.selectedAxis);
    const offset = state.curveDrag.handle === 1 ? 0 : 2;
    easing[offset] = Number(nx.toFixed(3));
    easing[offset + 1] = Number(ny.toFixed(3));
    from.easing[state.selectedAxis] = easing;
    validateBounds({ notify: true });
    markDirty();
    renderLive();
    renderCurveEditor();
  });

  const endCurveDrag = (event) => {
    if (!state.curveDrag || event.pointerId !== state.curveDrag.pointerId) return;
    state.curveDrag = null;
    els.curveSvg.querySelectorAll(".curve-handle").forEach((handle) => handle.classList.remove("is-active"));
    els.statusMessage.textContent = `${AXIS_META[state.selectedAxis].label}缓动已调整`;
  };
  els.curveSvg.addEventListener("pointerup", endCurveDrag);
  els.curveSvg.addEventListener("pointercancel", endCurveDrag);
}

function clientToSvg(event) {
  const rect = els.curveSvg.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 320,
    y: ((event.clientY - rect.top) / rect.height) * 172,
  };
}

function bindInspector() {
  els.addKeyBtn.addEventListener("click", addKeyframe);
  els.deleteKeyBtn.addEventListener("click", deleteKeyframe);

  els.positionX.addEventListener("change", () => {
    updateValues((values) => {
      values.position.x = clamp(Number(els.positionX.value) || 0, -1500, 2500);
    });
  });
  els.positionY.addEventListener("change", () => {
    updateValues((values) => {
      values.position.y = clamp(Number(els.positionY.value) || 0, -1500, 2500);
    });
  });
  els.scaleRange.addEventListener("input", () => {
    updateValues((values) => {
      values.scale = clamp(Number(els.scaleRange.value), 0.5, 2.2);
    }, { source: "scale" });
  });
  els.scaleValue.addEventListener("change", () => {
    updateValues((values) => {
      values.scale = clamp(Number(els.scaleValue.value) || 1, 0.5, 2.2);
    });
  });
  els.rotationRange.addEventListener("input", () => {
    updateValues((values) => {
      values.rotation = clamp(Number(els.rotationRange.value), -20, 20);
    }, { source: "rotation" });
  });
  els.rotationValue.addEventListener("change", () => {
    updateValues((values) => {
      values.rotation = clamp(Number(els.rotationValue.value) || 0, -180, 180);
    });
  });
  els.focusX.addEventListener("change", () => {
    updateValues((values) => {
      values.focus.x = clamp(Number(els.focusX.value) || 0, -100, 100);
    });
  });
  els.focusY.addEventListener("change", () => {
    updateValues((values) => {
      values.focus.y = clamp(Number(els.focusY.value) || 0, -100, 100);
    });
  });

  els.beatToggle.addEventListener("change", () => {
    state.project.sound.enabled = els.beatToggle.checked;
    markDirty();
    if (state.playing) {
      if (els.beatToggle.checked) startBeatClock();
      else stopBeatClock();
    }
  });
  els.bpmInput.addEventListener("change", () => {
    const bpm = clamp(Number(els.bpmInput.value) || 96, 40, 220);
    els.bpmInput.value = String(bpm);
    state.project.sound.bpm = bpm;
    markDirty();
    renderTimeline();
    if (state.playing) startBeatClock();
  });
}

function updateValues(mutator, { source = "" } = {}) {
  const values = currentValues();
  mutator(values);
  if (source) {
    values.scale = clamp(values.scale, 0.5, 2.2);
    values.rotation = clamp(values.rotation, -20, 20);
  }
  commitCurrentValues(values, { notify: true });
  els.statusMessage.textContent = `${source ? AXIS_META[source]?.label || "数值" : "镜头参数"}已记录于 ${formatSeconds(state.time)}`;
}

function bindActions() {
  els.loadSampleBtn.addEventListener("click", loadSample);
  els.checkBoundsBtn.addEventListener("click", () => {
    const violation = validateBounds({ notify: true });
    if (violation) {
      showToast(
        "danger",
        "整段路径检查未通过",
        `${formatSeconds(violation.time)} · 取景框越过${violation.side}边界 ${violation.overshoot.toFixed(0)}px`,
        5200,
      );
    } else {
      showToast("success", "整段路径检查通过", "8 秒镜头内所有取景框四角均在舞台范围内。");
      els.statusMessage.textContent = "路径检查通过 · 可安全保存";
    }
  });
  els.reloadBtn.addEventListener("click", reloadAndVerify);
  els.saveBtn.addEventListener("click", () => saveProject());
  els.exportBtn.addEventListener("click", exportProject);
  els.closeDialogBtn.addEventListener("click", () => els.verifyDialog.close());
  els.dialogDoneBtn.addEventListener("click", () => els.verifyDialog.close());
}

function loadSample() {
  pausePlayback();
  state.project = createSampleProject();
  state.time = 0;
  state.selectedSegment = 0;
  state.selectedAxis = "position";
  els.loopToggle.checked = true;
  els.beatToggle.checked = false;
  els.bpmInput.value = String(state.project.sound.bpm);
  validateBounds();
  renderTimeline();
  renderLive();
  renderer.resize();
  state.savedFingerprint = projectFingerprint(state.project);
  saveProject({ silent: true });
  updateSaveState();
  els.statusMessage.textContent = "已载入内置八秒镜头 · 四轴完整";
  showToast("success", "八秒样例已载入", "6 个四轴关键帧 · 路段边界安全");
}

function saveProject({ silent = false } = {}) {
  const violation = validateBounds({ notify: true });
  if (violation) {
    showToast(
      "danger",
      "保存已阻止",
      `取景框在 ${formatSeconds(violation.time)} 越过舞台${violation.side}边界。请修正路径。`,
      4800,
    );
    els.statusMessage.textContent = "保存被阻止 · 请修正越界路径";
    return false;
  }
  try {
    localStorage.setItem(STORAGE_KEY, projectToJSON(state.project));
    state.savedFingerprint = projectFingerprint(state.project);
    updateSaveState();
    els.statusMessage.textContent = "工程已保存到本地";
    if (!silent) {
      showToast("success", "工程已保存", `${state.project.keyframes.length} 个关键帧 · 四轴数据已写入`);
    }
    return true;
  } catch (error) {
    console.error("Save failed.", error);
    showToast("danger", "保存失败", "浏览器无法写入本地存储。");
    els.statusMessage.textContent = "保存失败 · localStorage 不可用";
    return false;
  }
}

function exportProject() {
  if (!saveProject({ silent: true })) return;
  const json = projectToJSON(state.project);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "rooftop-pass-shot08.json";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("success", "JSON 已导出", "cutline.camera-shot v1 · 8.0 秒 · 四轴关键帧");
  els.statusMessage.textContent = "JSON 导出完成";
}

function reloadAndVerify() {
  const violation = validateBounds({ notify: true });
  if (violation) {
    showToast("danger", "无法重载", "当前工程路径越界，保存被阻止。请修正后再校验。", 4800);
    return;
  }
  if (!saveProject({ silent: true })) return;
  const payload = {
    snapshot: projectToJSON(state.project),
    fingerprint: projectFingerprint(state.project),
    savedAt: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(VERIFY_KEY, JSON.stringify(payload));
    stopBeatClock();
    window.location.reload();
  } catch (error) {
    console.error("Reload verification could not be prepared.", error);
    showToast("danger", "重载校验失败", "浏览器无法写入会话存储。");
  }
}

function runPendingReloadVerification() {
  let request = null;
  try {
    const raw = sessionStorage.getItem(VERIFY_KEY);
    if (raw) request = JSON.parse(raw);
    sessionStorage.removeItem(VERIFY_KEY);
  } catch (error) {
    return;
  }
  if (!request?.snapshot) return;
  const expected = normalizeProject(JSON.parse(request.snapshot));
  const results = verifyRestoration(expected, state.project, 49);
  showVerification(results, request);
}

function showVerification(results, request) {
  const successful = results.filter((result) => result.ok).length;
  els.verifyList.replaceChildren();
  results.forEach((result) => {
    const row = document.createElement("div");
    row.className = "verify-row";
    row.style.setProperty("--axis-color", result.color);
    const swatch = document.createElement("span");
    swatch.className = "axis-swatch";
    const label = document.createElement("strong");
    label.textContent = result.label;
    const samples = document.createElement("small");
    samples.textContent = `${result.samples} 个采样点`;
    const status = document.createElement("em");
    status.textContent = result.ok ? "恢复一致" : `偏差 ${result.maxDelta.toFixed(4)}`;
    row.append(swatch, label, samples, status);
    els.verifyList.append(row);
  });
  els.verifySummary.innerHTML = `<strong>${successful} / ${results.length}</strong><span>${successful === 4 ? "轴完全恢复" : "轴恢复失败"}</span>`;
  els.statusMessage.textContent = `重载校验完成 · ${successful}/4 轴恢复`;
  if (successful === 4) {
    showToast("success", "重载校验通过", "位置、缩放、旋转、焦点四项全部恢复。");
  } else {
    showToast("danger", "重载校验未通过", "至少一个轴的采样值与保存前不一致。");
  }
  if (typeof els.verifyDialog.showModal === "function") {
    els.verifyDialog.showModal();
  }
}

function bindKeyboard() {
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveProject();
      return;
    }
    if (editing) return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key.toLowerCase() === "k") {
      event.preventDefault();
      addKeyframe();
    } else if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveProject();
    }
  });
}

boot();
