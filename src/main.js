import { StudioAudio } from "./audio.js";
import {
  CAMERA_LIMITS,
  LIGHT_FIXTURES,
  StudioEngine,
  WORLD,
  clamp,
  normalizeAngle,
} from "./engine.js";
import { StudioRenderer } from "./renderer.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  stage: $("#stage-canvas"),
  monitor: $("#monitor-canvas"),
  startOverlay: $("#start-overlay"),
  startButton: $("#start-button"),
  roundOverlay: $("#round-overlay"),
  nextRoundButton: $("#next-round-button"),
  nextRoundLabel: $("#next-round-label"),
  roundLabel: $("#round-label"),
  progressLabel: $("#progress-label"),
  soundButton: $("#sound-button"),
  soundLabel: $("#sound-label"),
  shotTitle: $("#shot-title"),
  shotBrief: $("#shot-brief"),
  shotCounter: $("#shot-counter"),
  targetTags: $("#target-tags"),
  contactSheet: $("#contact-sheet"),
  monitorStatus: $("#monitor-status"),
  canvasHudBeat: $("#beat-label"),
  pauseScrim: $("#pause-scrim"),
  pauseButton: $("#pause-button"),
  pauseIcon: $("#pause-icon"),
  pauseLabel: $("#pause-label"),
  shutterButton: $("#shutter-button"),
  feedback: $("#feedback"),
  feedbackText: $("#feedback-text"),
  exposureValue: $("#exposure-value"),
  exposureTarget: $("#exposure-target"),
  exposureFill: $("#exposure-fill"),
  cameraX: $("#camera-x"),
  cameraY: $("#camera-y"),
  focal: $("#focal-length"),
  cameraXValue: $("#camera-x-value"),
  cameraYValue: $("#camera-y-value"),
  focalValue: $("#focal-value"),
  lightA: $("#light-a"),
  lightB: $("#light-b"),
  lightAValue: $("#light-a-value"),
  lightBValue: $("#light-b-value"),
};

const engine = new StudioEngine();
engine.setPaused(true);
const audio = new StudioAudio();
const renderer = new StudioRenderer(elements.stage, elements.monitor);

let started = false;
let lastFrame = performance.now();
let lastUiRefresh = 0;
let lastSheetKey = "";
let feedbackOverride = null;
let roundOverlayTimer = 0;
let dragState = null;

function formatBeat(index) {
  return String((index % 8) + 1).padStart(2, "0");
}

function setFeedback(text, type = "neutral", duration = 0) {
  feedbackOverride = { text, type, expiresAt: duration ? performance.now() + duration : 0 };
  renderFeedback();
}

function renderFeedback() {
  let text;
  let type;
  if (feedbackOverride && (!feedbackOverride.expiresAt || performance.now() < feedbackOverride.expiresAt)) {
    text = feedbackOverride.text;
    type = feedbackOverride.type;
  } else {
    feedbackOverride = null;
    const analysis = engine.analyze();
    if (engine.paused) {
      text = "时间冻结：演员、节拍与曝光读数已停在当前帧。";
      type = "neutral";
    } else if (engine.roundComplete) {
      text = "三帧已通过，本轮冲洗完成。";
      type = "success";
    } else if (analysis.ready) {
      text = "构图与曝光都已到位，现在按快门。";
      type = "ready";
    } else {
      text = analysis.message;
      type = analysis.overexposed ? "error" : "neutral";
    }
  }

  elements.feedback.className = `feedback ${type === "ready" ? "ready" : type}`;
  elements.feedbackText.textContent = text;
}

function updateControlReadouts() {
  elements.cameraX.value = Math.round(engine.camera.x);
  elements.cameraY.value = Math.round(engine.camera.y);
  elements.focal.value = Math.round(engine.camera.focal);
  elements.lightA.value = Math.round(engine.lights[0].angle);
  elements.lightB.value = Math.round(engine.lights[1].angle);
  elements.cameraXValue.textContent = Math.round(engine.camera.x);
  elements.cameraYValue.textContent = Math.round(engine.camera.y);
  elements.focalValue.textContent = `${Math.round(engine.camera.focal)}mm`;
  elements.lightAValue.textContent = `${Math.round(engine.lights[0].angle)}°`;
  elements.lightBValue.textContent = `${Math.round(engine.lights[1].angle)}°`;
}

function updatePauseUi() {
  const paused = engine.paused;
  elements.pauseScrim.hidden = !paused || engine.roundComplete || !started;
  elements.pauseIcon.textContent = paused ? "▶" : "Ⅱ";
  elements.pauseLabel.textContent = paused ? "继续" : "暂停";
  elements.pauseButton.setAttribute("aria-pressed", String(paused));
}

async function togglePause(force) {
  if (!started || engine.roundComplete) return;
  if (typeof force === "boolean") engine.setPaused(force);
  else engine.togglePause();
  const paused = engine.paused;
  lastFrame = performance.now();
  updatePauseUi();
  renderFeedback();
  if (paused) {
    await audio.suspend();
  } else {
    await audio.resume();
  }
}

async function startGame() {
  if (started) return;
  started = true;
  engine.setPaused(false);
  elements.startOverlay.hidden = true;
  await audio.start();
  audio.tick(engine.beatIndex);
  lastFrame = performance.now();
  updatePauseUi();
  setFeedback("节拍已启动。先调灯，再等构图窗口。", "ready", 2200);
  window.__studioReady = true;
}

elements.startButton.addEventListener("click", startGame);
elements.pauseButton.addEventListener("click", () => togglePause());

function takePhoto() {
  if (!started) return;
  const result = engine.capture();
  if (result.code === "paused" || result.code === "complete") {
    setFeedback(result.message, "neutral", 1600);
    return;
  }
  audio.shutter();
  if (result.ok) {
    audio.success();
    setFeedback(
      engine.roundComplete ? "三帧全部通过。正在收冲洗底片…" : `${result.message} 准备下一镜。`,
      "success",
      2300,
    );
  } else {
    audio.failure();
    setFeedback(result.message, "error", 2400);
  }

  if (engine.roundComplete) {
    window.clearTimeout(roundOverlayTimer);
    roundOverlayTimer = window.setTimeout(showRoundOverlay, 620);
    audio.suspend();
  }
  refreshUi(true);
}

function showRoundOverlay() {
  elements.nextRoundLabel.textContent = String(engine.round + 1).padStart(2, "0");
  elements.roundOverlay.hidden = false;
  updatePauseUi();
}

async function startNextRound() {
  window.clearTimeout(roundOverlayTimer);
  elements.roundOverlay.hidden = true;
  engine.nextRound();
  engine.setPaused(false);
  updatePauseUi();
  updateControlReadouts();
  await audio.resume();
  audio.tick(engine.beatIndex);
  lastFrame = performance.now();
  lastSheetKey = "";
  feedbackOverride = null;
  setFeedback(`第 ${engine.round} 轮开始：节拍更快，构图容差更窄。`, "ready", 2600);
  refreshUi(true);
}

elements.shutterButton.addEventListener("click", takePhoto);
elements.nextRoundButton.addEventListener("click", startNextRound);

elements.soundButton.addEventListener("click", async () => {
  const muted = audio.toggleMuted();
  elements.soundLabel.textContent = muted ? "声音关" : "声音开";
  elements.soundButton.classList.toggle("muted", muted);
  if (!muted && started) await audio.start();
});

function clearTransientFeedback() {
  feedbackOverride = null;
  refreshUi(true);
}

elements.cameraX.addEventListener("input", () => {
  engine.setCamera({ x: Number(elements.cameraX.value) });
  clearTransientFeedback();
});
elements.cameraY.addEventListener("input", () => {
  engine.setCamera({ y: Number(elements.cameraY.value) });
  clearTransientFeedback();
});
elements.focal.addEventListener("input", () => {
  engine.setCamera({ focal: Number(elements.focal.value) });
  clearTransientFeedback();
});
elements.lightA.addEventListener("input", () => {
  engine.setLightAngle(0, Number(elements.lightA.value));
  clearTransientFeedback();
});
elements.lightB.addEventListener("input", () => {
  engine.setLightAngle(1, Number(elements.lightB.value));
  clearTransientFeedback();
});

function pointFromEvent(event) {
  const rect = elements.stage.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * WORLD.width,
    y: ((event.clientY - rect.top) / rect.height) * WORLD.height,
  };
}

function hitHandle(point) {
  const handles = [
    { type: "camera", index: -1, x: engine.camera.x, y: engine.camera.y, radius: 38 },
    ...LIGHT_FIXTURES.map((fixture, index) => ({
      type: "light",
      index,
      x: fixture.x,
      y: fixture.y,
      radius: 27,
    })),
  ];
  return handles
    .map((handle) => ({ ...handle, distance: Math.hypot(point.x - handle.x, point.y - handle.y) }))
    .filter((handle) => handle.distance <= handle.radius)
    .sort((a, b) => a.distance - b.distance)[0];
}

elements.stage.addEventListener("pointerdown", (event) => {
  const point = pointFromEvent(event);
  const handle = hitHandle(point);
  if (!handle) return;
  event.preventDefault();
  elements.stage.setPointerCapture(event.pointerId);
  if (handle.type === "camera") {
    dragState = {
      type: "camera",
      offsetX: engine.camera.x - point.x,
      offsetY: engine.camera.y - point.y,
    };
  } else {
    dragState = { type: "light", index: handle.index };
    updateLightAngle(handle.index, point);
  }
  elements.stage.style.cursor = "grabbing";
});

elements.stage.addEventListener("pointermove", (event) => {
  const point = pointFromEvent(event);
  if (!dragState) {
    elements.stage.style.cursor = hitHandle(point) ? "grab" : "crosshair";
    return;
  }
  event.preventDefault();
  if (dragState.type === "camera") {
    engine.setCamera({
      x: point.x + dragState.offsetX,
      y: point.y + dragState.offsetY,
    });
    updateControlReadouts();
  } else {
    updateLightAngle(dragState.index, point);
  }
  clearTransientFeedback();
});

function endDrag(event) {
  if (!dragState) return;
  dragState = null;
  elements.stage.style.cursor = "crosshair";
  if (elements.stage.hasPointerCapture?.(event.pointerId)) {
    elements.stage.releasePointerCapture(event.pointerId);
  }
}

elements.stage.addEventListener("pointerup", endDrag);
elements.stage.addEventListener("pointercancel", endDrag);

function updateLightAngle(index, point) {
  const fixture = LIGHT_FIXTURES[index];
  const angle = normalizeAngle(
    (Math.atan2(point.y - fixture.y, point.x - fixture.x) * 180) / Math.PI,
  );
  engine.setLightAngle(index, angle);
  updateControlReadouts();
}

function refreshContactSheet(analysis) {
  const key = `${engine.round}-${engine.shotIndex}-${engine.completedShots.length}-${engine.roundComplete}`;
  if (key === lastSheetKey) return;
  lastSheetKey = key;
  const shots = engine.shots;
  elements.contactSheet.innerHTML = shots
    .map((shot, index) => {
      const passed = engine.completedShots.some((result) => result.shotId === shot.id);
      const active = !passed && engine.shotIndex === index && !engine.roundComplete;
      const centerX = (shot.target.x[0] + shot.target.x[1]) / 2;
      const centerY = (shot.target.y[0] + shot.target.y[1]) / 2;
      return `
        <div class="contact-frame${passed ? " passed" : ""}${active ? " active" : ""}" data-shot="${shot.id}">
          <span class="frame-number">${String(shot.id).padStart(2, "0")} / ${shot.lens.toUpperCase()}</span>
          <span class="mini-subject" style="left:${(centerX * 100).toFixed(1)}%;top:${(centerY * 100).toFixed(1)}%"></span>
          <span class="frame-name">${shot.short}</span>
          <span class="frame-state">${passed ? "PASS" : active ? "LIVE" : "WAIT"}</span>
        </div>
      `;
    })
    .join("");
}

function refreshUi(force = false) {
  const analysis = engine.analyze();
  const shot = analysis.shot;
  updateControlReadouts();
  elements.roundLabel.textContent = String(engine.round).padStart(2, "0");
  elements.progressLabel.textContent = `${engine.completedShots.length} / 3`;
  elements.shotTitle.textContent = shot?.title ?? "冲洗中";
  elements.shotBrief.textContent = shot?.brief ?? "";
  elements.shotCounter.textContent = engine.roundComplete
    ? "SHOT 03 / 03"
    : `SHOT ${String(engine.shotIndex + 1).padStart(2, "0")} / 03`;
  elements.canvasHudBeat.textContent = formatBeat(engine.beatIndex);

  const tagState = [
    ["主体入框", analysis.subjectInFrame],
    ["命中构图", analysis.insideTargetX && analysis.insideTargetY],
    ["焦段正确", analysis.focalReady],
    ["曝光合格", analysis.exposureReady && !analysis.overexposed],
  ];
  elements.targetTags.innerHTML = tagState
    .map(([label, active]) => `<span class="target-tag${active ? " ok" : ""}">${label}</span>`)
    .join("");

  const exposure = clamp(analysis.exposure ?? 0, 0, 1);
  elements.exposureValue.textContent = `${Math.round(exposure * 100)}%${analysis.overexposed ? " · OVER" : ""}`;
  elements.exposureFill.style.left = `${exposure * 100}%`;
  if (shot) {
    const [low, high] = shot.exposure;
    elements.exposureTarget.style.left = `${low * 100}%`;
    elements.exposureTarget.style.width = `${(high - low) * 100}%`;
  }

  let monitorStatus = "TRACKING";
  let monitorClass = "";
  if (analysis.complete) {
    monitorStatus = "APPROVED";
    monitorClass = "ready";
  } else if (analysis.overexposed) {
    monitorStatus = "OVEREXPOSED";
    monitorClass = "over";
  } else if (analysis.ready) {
    monitorStatus = "READY / SHOOT";
    monitorClass = "ready";
  } else if (analysis.windowOpen) {
    monitorStatus = "FRAME / LOCKED";
  }
  elements.monitorStatus.textContent = monitorStatus;
  elements.monitorStatus.className = `monitor-status ${monitorClass}`;

  refreshContactSheet(analysis);
  updatePauseUi();
  renderFeedback();
  if (force) lastUiRefresh = performance.now();
}

function animate(now) {
  const delta = Math.min(120, Math.max(0, now - lastFrame));
  lastFrame = now;
  if (started) {
    const clock = engine.update(delta);
    if (clock.beatChanged) {
      audio.tick(clock.beatIndex);
    }
    if (now - lastUiRefresh > 65) {
      refreshUi();
      lastUiRefresh = now;
    }
  }
  renderer.render(engine, now);
  requestAnimationFrame(animate);
}

function handleKeyboard(event) {
  if (!started) return;
  const tag = event.target.tagName;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) && event.code !== "Space") return;
  const key = event.key.toLowerCase();
  const cameraStep = event.shiftKey ? 14 : 5;
  let handled = true;

  if (event.code === "Space") {
    event.preventDefault();
    takePhoto();
  } else if (key === "p") {
    togglePause();
  } else if (key === "arrowleft") {
    engine.setCamera({ x: engine.camera.x - cameraStep });
  } else if (key === "arrowright") {
    engine.setCamera({ x: engine.camera.x + cameraStep });
  } else if (key === "arrowup") {
    engine.setCamera({ y: engine.camera.y - cameraStep });
  } else if (key === "arrowdown") {
    engine.setCamera({ y: engine.camera.y + cameraStep });
  } else if (key === "=" || key === "+") {
    engine.setCamera({ focal: engine.camera.focal + 1 });
  } else if (key === "-" || key === "_") {
    engine.setCamera({ focal: engine.camera.focal - 1 });
  } else if (key === "a") {
    engine.setLightAngle(0, engine.lights[0].angle - 2);
  } else if (key === "d") {
    engine.setLightAngle(0, engine.lights[0].angle + 2);
  } else if (key === "j") {
    engine.setLightAngle(1, engine.lights[1].angle - 2);
  } else if (key === "l") {
    engine.setLightAngle(1, engine.lights[1].angle + 2);
  } else if (key === "m") {
    elements.soundButton.click();
  } else {
    handled = false;
  }

  if (handled && !["p", "m"].includes(key) && event.code !== "Space") {
    clearTransientFeedback();
  }
}

document.addEventListener("keydown", handleKeyboard);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && started && !engine.paused && !engine.roundComplete) {
    togglePause(true);
  }
});

window.__studio = {
  engine,
  audio,
  takePhoto,
  togglePause,
  startGame,
  startNextRound,
  getState: () => engine.getPublicState(),
};

requestAnimationFrame(animate);
refreshUi(true);
