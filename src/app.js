import { TideAudio } from "./audio.js";
import { OceanRenderer } from "./renderer.js";
import {
  DEFAULT_CONFIGS,
  FLEET,
  MAX_TIME,
  SAMPLE_EVERY,
  SIM_DT,
  cloneConfigs,
  environmentHash,
  runSimulation
} from "./simulation.js";

const FRAME_TIME = SIM_DT * SAMPLE_EVERY;
const PLAYBACK_RATE = 2.4;
const STEP_FRAMES = 5;

const $ = (selector) => document.querySelector(selector);
const canvas = $("#oceanCanvas");
const renderer = new OceanRenderer(canvas);
const audio = new TideAudio();
const elements = {
  seedInput: $("#seedInput"),
  randomSeed: $("#randomSeed"),
  environmentHash: $("#environmentHash"),
  hudSeed: $("#hudSeed"),
  fleetControls: $("#fleetControls"),
  restoreConfigs: $("#restoreConfigs"),
  resetRun: $("#resetRun"),
  lockState: $(".lock-state"),
  lockLabel: $("#lockLabel"),
  stageStatus: $("#stageStatus"),
  checkpointStrip: $("#checkpointStrip"),
  simTime: $("#simTime"),
  timelineFill: $("#timelineFill"),
  timelineHead: $("#timelineHead"),
  playButton: $("#playButton"),
  playLabel: $("#playLabel"),
  playIcon: $(".play-icon"),
  stepButton: $("#stepButton"),
  replayButton: $("#replayButton"),
  overlayButton: $("#overlayButton"),
  audioToggle: $("#audioToggle"),
  audioLabel: $("#audioLabel"),
  currentReadout: $("#currentReadout"),
  frameReadout: $("#frameReadout"),
  replayBadge: $("#replayBadge"),
  speedMetric: $("#speedMetric"),
  speedMeter: $("#speedMeter"),
  tensionMetric: $("#tensionMetric"),
  tensionMeter: $("#tensionMeter"),
  collisionMetric: $("#collisionMetric"),
  footerHash: $("#footerHash"),
  resultOverlay: $("#resultOverlay"),
  resultCard: $(".result-card"),
  resultGlyph: $("#resultGlyph"),
  resultKicker: $("#resultKicker"),
  resultTitle: $("#resultTitle"),
  resultSummary: $("#resultSummary"),
  resultTime: $("#resultTime"),
  resultCollisions: $("#resultCollisions"),
  resultHash: $("#resultHash"),
  resultFleet: $("#resultFleet"),
  resultReplay: $("#resultReplay"),
  resultInspect: $("#resultInspect"),
  resultNext: $("#resultNext"),
  toast: $("#toast")
};

const state = {
  seed: "NORD-17",
  configs: cloneConfigs(DEFAULT_CONFIGS),
  run: null,
  previousRun: null,
  frameIndex: 0,
  frameAccumulator: 0,
  mode: "idle",
  locked: false,
  overlay: true,
  replayCheck: null,
  lastTimestamp: performance.now(),
  toastTimer: null,
  autoPreviewTimer: null
};

function buildFleetControls() {
  elements.fleetControls.innerHTML = FLEET.map((boat, index) => {
    const config = state.configs[index];
    return `
      <article class="fleet-card" data-boat="${index}" style="--accent:${boat.color}">
        <div class="card-head">
          <div class="boat-ident">
            <span class="boat-swatch"></span>
            <div><small>${boat.callsign}</small><strong>${boat.name}</strong></div>
          </div>
          <span class="card-status" data-status="${index}">待命</span>
        </div>
        <div class="curve-head">
          <span>推力曲线 / 5 节点</span>
          <output data-curve-output="${index}">--</output>
        </div>
        <div class="thrust-editor">
          ${config.thrust.map((value, step) => `
            <label class="thrust-slot" title="第 ${step + 1} 节点推力">
              <input class="thrust-slider" data-boat="${index}" data-step="${step}"
                type="range" min="15" max="100" step="1" value="${Math.round(value * 100)}"
                aria-label="${boat.callsign} 第 ${step + 1} 节点推力">
              <small data-value="${index}-${step}">${Math.round(value * 100)}</small>
            </label>
          `).join("")}
        </div>
        <div class="threshold-row">
          <div>
            <div class="threshold-label"><span>转向阈值</span><output data-threshold-output="${index}">${config.threshold}°</output></div>
            <div class="threshold-control">
              <input class="threshold-slider" data-boat="${index}" type="range" min="4" max="55" step="1"
                value="${config.threshold}" aria-label="${boat.callsign} 转向阈值">
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");
  updateCurveOutputs();
  wireConfigInputs();
}

function updateCurveOutputs() {
  state.configs.forEach((config, index) => {
    const average = Math.round(config.thrust.reduce((total, value) => total + value, 0) / config.thrust.length * 100);
    const output = document.querySelector(`[data-curve-output="${index}"]`);
    if (output) output.textContent = `AVG ${average}%`;
    const thresholdOutput = document.querySelector(`[data-threshold-output="${index}"]`);
    if (thresholdOutput) thresholdOutput.textContent = `${config.threshold}°`;
    config.thrust.forEach((value, step) => {
      const label = document.querySelector(`[data-value="${index}-${step}"]`);
      if (label) label.textContent = Math.round(value * 100);
    });
  });
}

function wireConfigInputs() {
  document.querySelectorAll(".thrust-slider").forEach((input) => {
    input.addEventListener("input", () => {
      if (state.locked) return;
      const boat = Number(input.dataset.boat);
      const step = Number(input.dataset.step);
      state.configs[boat].thrust[step] = Number(input.value) / 100;
      updateCurveOutputs();
    });
  });
  document.querySelectorAll(".threshold-slider").forEach((input) => {
    input.addEventListener("input", () => {
      if (state.locked) return;
      const boat = Number(input.dataset.boat);
      state.configs[boat].threshold = Number(input.value);
      updateCurveOutputs();
    });
  });
}

function syncConfigInputs() {
  document.querySelectorAll(".thrust-slider").forEach((input) => {
    const boat = Number(input.dataset.boat);
    const step = Number(input.dataset.step);
    input.value = Math.round(state.configs[boat].thrust[step] * 100);
  });
  document.querySelectorAll(".threshold-slider").forEach((input) => {
    input.value = state.configs[Number(input.dataset.boat)].threshold;
  });
  updateCurveOutputs();
}

function setLocked(locked) {
  state.locked = locked;
  elements.seedInput.disabled = locked;
  elements.randomSeed.disabled = locked;
  elements.restoreConfigs.disabled = locked;
  elements.resetRun.hidden = !locked;
  elements.lockState.classList.toggle("locked", locked);
  elements.lockLabel.textContent = locked ? "参数锁止" : "可编辑";
  document.querySelectorAll(".fleet-card").forEach((card) => card.classList.toggle("disabled", locked));
  document.querySelectorAll(".thrust-slider, .threshold-slider").forEach((input) => {
    input.disabled = locked;
  });
}

function previewWorld() {
  if (state.locked) return;
  state.seed = elements.seedInput.value.trim().toUpperCase() || "NORD-17";
  elements.seedInput.value = state.seed;
  state.run = runSimulation(state.seed, state.configs);
  state.previousRun = null;
  state.frameIndex = 0;
  state.frameAccumulator = 0;
  state.mode = "idle";
  state.replayCheck = null;
  elements.replayBadge.hidden = true;
  elements.replayButton.disabled = true;
  elements.overlayButton.disabled = true;
  elements.resultOverlay.hidden = true;
  updateStaticReadouts();
  updatePlayButton();
}

function updateStaticReadouts() {
  const env = environmentHash(state.seed);
  elements.environmentHash.textContent = `ENV ${env}`;
  elements.hudSeed.textContent = state.seed;
  elements.footerHash.textContent = `RUN ${state.run?.hash || "--------"}`;
  renderCheckpointStrip();
}

function prepareFreshRun() {
  state.seed = elements.seedInput.value.trim().toUpperCase() || "NORD-17";
  elements.seedInput.value = state.seed;
  state.run = runSimulation(state.seed, state.configs);
  state.frameIndex = 0;
  state.frameAccumulator = 0;
  state.replayCheck = null;
  setLocked(true);
  elements.resultOverlay.hidden = true;
  elements.replayButton.disabled = false;
  elements.overlayButton.disabled = !state.previousRun;
  elements.replayBadge.hidden = true;
  updateStaticReadouts();
}

function startPlayback() {
  prepareFreshRun();
  state.mode = "playing";
  updatePlayButton();
  setStageStatus("RUNNING · 模拟进行中", true);
}

function togglePlayback() {
  if (state.mode === "playing") {
    state.mode = "paused";
    setStageStatus("PAUSED · 已暂停");
  } else if (state.mode === "paused") {
    state.mode = "playing";
    setStageStatus("RUNNING · 模拟进行中", true);
  } else if (state.mode === "ended") {
    state.mode = "playing";
    elements.resultOverlay.hidden = true;
    state.frameIndex = 0;
    state.frameAccumulator = 0;
    updatePlayButton();
    setStageStatus("REPLAY · 重新回放", true);
  } else {
    startPlayback();
  }
  updatePlayButton();
}

function pausePlayback() {
  if (state.mode !== "playing") return;
  state.mode = "paused";
  updatePlayButton();
  setStageStatus("PAUSED · 已暂停");
}

function stepPlayback() {
  if (state.mode === "playing" || state.mode === "ended") return;
  if (!state.locked) {
    prepareFreshRun();
    state.mode = "paused";
  }
  const previous = state.frameIndex;
  const lastFrame = state.run.frames.length - 1;
  state.frameIndex = Math.min(lastFrame, state.frameIndex + STEP_FRAMES);
  state.frameAccumulator = state.frameIndex;
  emitPlaybackAudio(previous, state.frameIndex);
  if (state.frameIndex >= lastFrame) {
    finishRun();
  } else {
    state.mode = "paused";
    setStageStatus(`STEP · ${formatTime(currentFrame().time)}`);
  }
  updatePlayButton();
}

function replayRun() {
  if (!state.run || !state.locked) return;
  const baseline = state.run;
  const rerun = runSimulation(state.seed, state.configs);
  state.replayCheck = {
    matches: rerun.hash === baseline.hash,
    baseline: baseline.hash,
    replay: rerun.hash
  };
  state.previousRun = baseline;
  state.run = rerun;
  state.frameIndex = 0;
  state.frameAccumulator = 0;
  state.mode = "playing";
  state.overlay = true;
  state.pendingReplay = true;
  elements.resultOverlay.hidden = true;
  elements.replayBadge.hidden = false;
  elements.replayBadge.textContent = `REPLAY / ${rerun.hash}`;
  elements.overlayButton.disabled = false;
  elements.overlayButton.classList.toggle("active", state.overlay);
  setStageStatus("REPLAY · 重新回放", true);
  updatePlayButton();
  showToast(
    state.replayCheck.matches
      ? `回放一致 · 原始 ${baseline.hash} / 重跑 ${rerun.hash}`
      : `回放不一致 · ${baseline.hash} / ${rerun.hash}`,
    state.replayCheck.matches ? "" : "error",
    3600
  );
}

function toggleOverlay() {
  if (!state.previousRun) return;
  state.overlay = !state.overlay;
  elements.overlayButton.classList.toggle("active", state.overlay);
  showToast(state.overlay ? "已叠加上次航迹" : "已隐藏上次航迹");
}

function resetSetup() {
  state.mode = "idle";
  state.frameIndex = 0;
  state.frameAccumulator = 0;
  elements.resultOverlay.hidden = true;
  elements.replayBadge.hidden = true;
  elements.replayCheck = null;
  setLocked(false);
  state.run = runSimulation(state.seed, state.configs);
  elements.replayButton.disabled = !state.previousRun;
  elements.overlayButton.disabled = !state.previousRun;
  updateStaticReadouts();
  updatePlayButton();
  setStageStatus("STANDBY · 配置阶段");
}

function finishRun() {
  state.mode = "ended";
  state.frameIndex = state.run.frames.length - 1;
  state.replayCheck = state.pendingReplay ? state.replayCheck : null;
  state.pendingReplay = false;
  updatePlayButton();
  showResult();
  setStageStatus(state.run.victory ? "COMPLETE · 编队通过" : "INCOMPLETE · 任务未达成");
  elements.resultOverlay.hidden = false;
}

function updatePlayButton() {
  const labels = {
    idle: "开始模拟",
    playing: "暂停",
    paused: "继续",
    ended: "再次模拟"
  };
  elements.playLabel.textContent = labels[state.mode];
  const path = elements.playIcon.querySelector("path");
  if (state.mode === "playing") {
    path.setAttribute("d", "M7 5h4v14H7zM14 5h4v14h-4z");
  } else {
    path.setAttribute("d", "M8 5v14l11-7z");
  }
  elements.stepButton.disabled = state.mode === "playing" || state.mode === "ended";
  elements.replayButton.disabled = !state.locked || !state.run;
  elements.overlayButton.disabled = !state.previousRun;
}

function setStageStatus(text, running = false) {
  elements.stageStatus.textContent = text;
  elements.stageStatus.classList.toggle("running", running);
}

function showResult() {
  const run = state.run;
  const totalCollisions = run.fleet.reduce((sum, boat) => sum + boat.collisions, 0);
  elements.resultCard.classList.toggle("failed", !run.victory);
  elements.resultGlyph.textContent = run.victory ? "✓" : "×";
  elements.resultKicker.textContent = run.victory ? "MISSION COMPLETE" : "MISSION INCOMPLETE";
  elements.resultTitle.textContent = run.victory ? "编队通过" : "航路未贯通";
  elements.resultSummary.textContent = run.victory
    ? `${run.finishedCount} / 3 艘航标完成五个检查点，满足至少两艘通过的胜利条件。`
    : `仅 ${run.finishedCount} / 3 艘航标完成全部检查点，未达到两艘通过的胜利条件。`;
  elements.resultTime.textContent = `${run.duration.toFixed(1)}s`;
  elements.resultCollisions.textContent = String(totalCollisions);
  elements.resultHash.textContent = run.hash;
  elements.resultFleet.innerHTML = run.fleet.map((boat) => `
    <div class="result-boat" style="--boat-color:${boat.color}">
      <i></i>
      <span>${boat.callsign} · ${boat.name}</span>
      <small>${boat.completed}/5 · ${boat.collisions} 碰撞</small>
      <strong>${boat.finished ? "通过" : boat.status === "lost" ? "失联" : "未完成"}</strong>
    </div>
  `).join("");
  elements.footerHash.textContent = `RUN ${run.hash}`;
}

function currentFrame() {
  if (!state.run) return null;
  return state.run.frames[Math.min(state.frameIndex, state.run.frames.length - 1)];
}

function emitPlaybackAudio(fromIndex, toIndex) {
  if (!state.run) return;
  const from = state.run.frames[fromIndex]?.time ?? 0;
  const to = state.run.frames[toIndex]?.time ?? from;
  const crossed = state.run.events.filter((event) => event.time > from && event.time <= to);
  for (const event of crossed) {
    if (event.type === "collision" || event.type === "checkpoint") audio.blip(event.type);
  }
}

function formatTime(seconds) {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  const remaining = (safe % 60).toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${remaining}`;
}

function renderCheckpointStrip() {
  if (!state.run) return;
  const frame = currentFrame() || state.run.frames[0];
  elements.checkpointStrip.innerHTML = state.run.world.checkpoints.map((checkpoint, index) => {
    const completed = frame.boats.every((boat) => boat.completed > index);
    const active = frame.boats.some((boat) => boat.completed === index);
    return `<span class="checkpoint-pip${completed ? " passed" : active ? " active" : ""}">${completed ? "✓" : checkpoint.label}</span>`;
  }).join("");
}

function updateTelemetry(frame) {
  const boats = frame.boats.filter((boat) => boat.status !== "lost");
  const speed = boats.reduce((sum, boat) => sum + boat.speed, 0) / Math.max(1, boats.length);
  const tension = boats.reduce((sum, boat) => sum + boat.tension, 0) / Math.max(1, boats.length);
  const collisions = frame.boats.reduce((sum, boat) => sum + boat.collisions, 0);
  const flow = boats.reduce((sum, boat) => sum + Math.hypot(boat.currentX, boat.currentY), 0) / Math.max(1, boats.length);
  elements.speedMetric.textContent = `${speed.toFixed(1)} kn`;
  elements.speedMeter.style.width = `${Math.min(100, speed / 74 * 100)}%`;
  elements.tensionMetric.textContent = `${Math.round(tension * 100)}%`;
  elements.tensionMeter.style.width = `${Math.min(100, tension * 100)}%`;
  elements.collisionMetric.textContent = String(collisions);
  elements.currentReadout.textContent = `FLOW ${flow.toFixed(1)} kn`;
  elements.simTime.textContent = formatTime(frame.time);
  const progress = Math.min(1, frame.time / MAX_TIME);
  elements.timelineFill.style.width = `${progress * 100}%`;
  elements.timelineHead.style.left = `${progress * 100}%`;
  elements.frameReadout.textContent = `FRAME ${String(state.frameIndex).padStart(3, "0")} / ${String(state.run.frames.length - 1).padStart(3, "0")}`;
  updateFleetStatuses(frame);
  renderCheckpointStrip();
  audio.update(tension, speed, state.mode === "playing" || state.mode === "paused");
}

function updateFleetStatuses(frame) {
  frame.boats.forEach((boat, index) => {
    const status = document.querySelector(`[data-status="${index}"]`);
    if (!status) return;
    status.classList.remove("active", "success", "danger");
    if (boat.status === "finished") {
      status.textContent = "完成";
      status.classList.add("success");
    } else if (boat.status === "lost") {
      status.textContent = "失联";
      status.classList.add("danger");
    } else if (state.mode !== "idle") {
      status.textContent = `CP ${boat.completed}/5`;
      status.classList.add("active");
    } else {
      status.textContent = "待命";
    }
  });
}

function showToast(message, type = "", duration = 2400) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast visible ${type}`.trim();
  state.toastTimer = window.setTimeout(() => {
    elements.toast.className = "toast";
  }, duration);
}

function generateSeed() {
  const first = ["NORD", "TIDE", "RIFT", "CAPE", "SURF", "EDDY"];
  const word = first[Math.floor(Math.random() * first.length)];
  const code = Math.floor(10 + Math.random() * 89);
  return `${word}-${code}`;
}

function nextMission() {
  elements.seedInput.value = generateSeed();
  elements.resultOverlay.hidden = true;
  state.previousRun = null;
  state.overlay = true;
  elements.overlayButton.classList.remove("active");
  setLocked(false);
  previewWorld();
  showToast(`航行区已切换至 ${state.seed}`);
}

function animationLoop(timestamp) {
  const delta = Math.min(0.05, Math.max(0, (timestamp - state.lastTimestamp) / 1000));
  state.lastTimestamp = timestamp;

  if (state.mode === "playing" && state.run) {
    const previous = state.frameIndex;
    const lastFrame = state.run.frames.length - 1;
    state.frameAccumulator += (delta / FRAME_TIME) * PLAYBACK_RATE;
    state.frameIndex = Math.min(lastFrame, Math.floor(state.frameAccumulator));
    if (state.frameIndex !== previous) {
      emitPlaybackAudio(previous, state.frameIndex);
    }
    if (state.frameIndex >= lastFrame) finishRun();
  }

  if (state.run) {
    renderer.draw(state.run, state.frameIndex, {
      delta,
      overlayRun: state.overlay ? state.previousRun : null
    });
    updateTelemetry(currentFrame());
  }
  requestAnimationFrame(animationLoop);
}

async function toggleAudio() {
  try {
    if (audio.enabled) {
      audio.disable();
      elements.audioToggle.setAttribute("aria-pressed", "false");
      elements.audioLabel.textContent = "关闭";
      document.body.classList.remove("audio-on");
    } else {
      await audio.enable();
      elements.audioToggle.setAttribute("aria-pressed", "true");
      elements.audioLabel.textContent = "在线";
      document.body.classList.add("audio-on");
      const frame = currentFrame();
      if (frame) {
        const boats = frame.boats;
        const speed = boats.reduce((sum, boat) => sum + boat.speed, 0) / boats.length;
        const tension = boats.reduce((sum, boat) => sum + boat.tension, 0) / boats.length;
        audio.update(tension, speed, true);
      }
      showToast("声呐已开启 · 音高随航速与张力变化");
    }
  } catch (error) {
    showToast("当前浏览器无法启用 Web Audio", "error");
  }
}

elements.seedInput.addEventListener("input", () => {
  if (state.locked) return;
  elements.seedInput.value = elements.seedInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
});
elements.seedInput.addEventListener("change", previewWorld);
elements.seedInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    elements.seedInput.blur();
  }
});
elements.randomSeed.addEventListener("click", () => {
  if (state.locked) return;
  elements.seedInput.value = generateSeed();
  previewWorld();
});
elements.restoreConfigs.addEventListener("click", () => {
  if (state.locked) return;
  state.configs = cloneConfigs(DEFAULT_CONFIGS);
  syncConfigInputs();
  showToast("已恢复三艘航标的基准曲线");
});
elements.resetRun.addEventListener("click", resetSetup);
elements.playButton.addEventListener("click", togglePlayback);
elements.stepButton.addEventListener("click", stepPlayback);
elements.replayButton.addEventListener("click", replayRun);
elements.resultReplay.addEventListener("click", replayRun);
elements.resultInspect.addEventListener("click", () => {
  elements.resultOverlay.hidden = true;
  showToast("已叠加上本次三艘航标的完整轨迹");
});
elements.overlayButton.addEventListener("click", toggleOverlay);
elements.resultNext.addEventListener("click", nextMission);
elements.audioToggle.addEventListener("click", toggleAudio);

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    stepPlayback();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pausePlayback();
});

new ResizeObserver(() => renderer.resize()).observe(canvas.parentElement);
window.addEventListener("resize", () => renderer.resize());

buildFleetControls();
previewWorld();
requestAnimationFrame(() => {
  renderer.resize();
  state.lastTimestamp = performance.now();
  requestAnimationFrame(animationLoop);
});

window.__TIDELINE__ = {
  getSnapshot() {
    return {
      seed: state.seed,
      mode: state.mode,
      locked: state.locked,
      frameIndex: state.frameIndex,
      frameCount: state.run?.frames.length || 0,
      hash: state.run?.hash || null,
      finishedCount: state.run?.finishedCount || 0,
      victory: state.run?.victory || false
    };
  },
  runSimulation
};
