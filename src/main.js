import { AssemblyEngine } from "./engine.js";
import { SceneRenderer } from "./render.js";
import { SyncAudio } from "./audio.js";

const query = new URLSearchParams(window.location.search);
const testMode = query.has("e2e");
const engine = new AssemblyEngine({ e2e: testMode });
if (testMode) engine.setE2EOffsets(-0.052, 0.052);

const renderer = new SceneRenderer(document.querySelector("#scene"));
const audio = new SyncAudio();
const startedAt = performance.now();
let lastFrame = performance.now();

const dom = {
  body: document.body,
  fixtureReadout: document.querySelector("#fixtureReadout"),
  torchReadout: document.querySelector("#torchReadout"),
  fixtureSignal: document.querySelector("#fixtureSignal"),
  torchSignal: document.querySelector("#torchSignal"),
  countdown: document.querySelector("#countdown"),
  countdownRing: document.querySelector("#countdownRing"),
  countdownValue: document.querySelector("#countdownValue"),
  roundLabel: document.querySelector("#roundLabel"),
  syncFill: document.querySelector("#syncFill"),
  syncValue: document.querySelector("#syncValue"),
  stateKicker: document.querySelector("#stateKicker"),
  stateTitle: document.querySelector("#stateTitle"),
  stateHint: document.querySelector("#stateHint"),
  bannerText: document.querySelector("#bannerText"),
  phaseBanner: document.querySelector("#phaseBanner"),
  resultPanel: document.querySelector("#resultPanel"),
  resultCode: document.querySelector("#resultCode"),
  resultTitle: document.querySelector("#resultTitle"),
  resultText: document.querySelector("#resultText"),
  resultAction: document.querySelector("#resultAction"),
  groupLights: Array.from(document.querySelectorAll("#groupLights i")),
  spareCount: document.querySelector("#spareCount"),
  spareStack: Array.from(document.querySelectorAll("#spareStack i")),
  soundToggle: document.querySelector("#soundToggle"),
  sessionClock: document.querySelector("#sessionClock"),
  resetButton: document.querySelector("#resetButton"),
  screenFlash: document.querySelector("#screenFlash"),
  triggerButtons: {
    fixture: document.querySelector('[data-trigger="fixture"]'),
    torch: document.querySelector('[data-trigger="torch"]')
  }
};

const activeKeys = new Set();
const pointerTrims = new Map();
let soundEnabled = true;
let lastFailure = null;
let lastPhase = "";

const COPY = {
  feed: {
    kicker: "FEED CYCLE",
    title: "两侧半成品进站",
    hint: "夹具与焊枪正在接近装配中心",
    banner: "进料中 · 等待两侧半成品到位"
  },
  countdown: {
    kicker: "SENSOR VIBRATION",
    title: "倒计时定位窗口",
    hint: "轻微震动正在改变两侧偏差，可提前微调",
    banner: "倒计时 3 / 2 / 1 · 定位偏差正在变化"
  },
  align: {
    kicker: "AWAITING SYNC",
    title: "等待两侧同步就位",
    hint: "微调偏差至 ±25 μm，同时按住 F + J",
    banner: "就位窗口开启 · F + J 必须同步触发"
  },
  welding: {
    kicker: "ARC ACTIVE",
    title: "同步焊接进行中",
    hint: "双方保持触发，焊枪沿接缝上行",
    banner: "同步锁定 · 焊接轨迹生成中，请保持触发"
  },
  complete: {
    kicker: "GROUP SEALED",
    title: "本组装配完成",
    hint: "松开触发并等待下一组半成品进站",
    banner: "装配完成 · 正在交换下一组半成品"
  },
  failed: {
    kicker: "INTERLOCK TRIPPED",
    title: "安全互锁已触发",
    hint: "零件损毁，当前批次终止",
    banner: "互锁触发 · 零件损毁，备件已消耗"
  },
  success: {
    kicker: "CELL COMPLETE",
    title: "三组装配已完成",
    hint: "两套备件完整保留",
    banner: "任务完成 · 三组装配，两套备件保留"
  }
};

function signedMicrons(value) {
  const microns = Math.round(value * 1000);
  return `${microns >= 0 ? "+" : "-"}${String(Math.abs(microns)).padStart(2, "0")} μm`;
}

function updateTrimFromKeys() {
  if (activeKeys.size === 0 && pointerTrims.size === 0) {
    engine.setTrim("fixture", 0);
    engine.setTrim("torch", 0);
    return;
  }

  const fixtureKeys =
    (activeKeys.has("KeyD") || activeKeys.has("d") ? 1 : 0) -
    (activeKeys.has("KeyA") || activeKeys.has("a") ? 1 : 0);
  const torchKeys =
    (activeKeys.has("ArrowRight") || activeKeys.has("arrowright") ? 1 : 0) -
    (activeKeys.has("ArrowLeft") || activeKeys.has("arrowleft") ? 1 : 0);
  const fixturePointer = [...pointerTrims.values()]
    .filter((item) => item.side === "fixture")
    .reduce((sum, item) => sum + item.direction, 0);
  const torchPointer = [...pointerTrims.values()]
    .filter((item) => item.side === "torch")
    .reduce((sum, item) => sum + item.direction, 0);

  engine.setTrim("fixture", fixtureKeys + fixturePointer);
  engine.setTrim("torch", torchKeys + torchPointer);
}

function setTriggerVisual(side, held) {
  dom.triggerButtons[side].classList.toggle("is-held", held);
}

function pressTrigger(side) {
  audio.start();
  engine.pressTrigger(side);
  setTriggerVisual(side, engine.held[side]);
}

function releaseTrigger(side) {
  engine.releaseTrigger(side);
  setTriggerVisual(side, engine.held[side]);
}

function resetRun() {
  engine.reset();
  activeKeys.clear();
  pointerTrims.clear();
  lastFailure = null;
  lastPhase = "";
  Object.keys(dom.triggerButtons).forEach((side) => setTriggerVisual(side, false));
  dom.resultPanel.hidden = true;
  dom.resultPanel.classList.remove("is-success");
  engine.consumeEvents();
}

function flashScreen() {
  dom.screenFlash.classList.remove("is-active");
  void dom.screenFlash.offsetWidth;
  dom.screenFlash.classList.add("is-active");
  window.setTimeout(() => dom.screenFlash.classList.remove("is-active"), 500);
}

function updateUi(state) {
  const copy = COPY[state.phase] || COPY.feed;
  const syncPercent = Math.round(state.sync * 100);
  const countdownProgress =
    state.phase === "countdown"
      ? state.phaseElapsed / 3
      : state.phase === "align"
        ? 1
        : state.phase === "welding"
          ? state.weldProgress
          : state.phase === "complete" || state.phase === "failed" || state.phase === "success"
            ? 1
            : 0;

  dom.body.dataset.phase = state.phase;
  dom.fixtureReadout.textContent = signedMicrons(state.fixtureError);
  dom.torchReadout.textContent = signedMicrons(state.torchError);
  dom.fixtureReadout.style.color = Math.abs(state.fixtureError) <= 0.025 ? "#b4f36b" : "";
  dom.torchReadout.style.color = Math.abs(state.torchError) <= 0.025 ? "#b4f36b" : "";
  dom.fixtureSignal.style.opacity = String(
    Math.max(0.2, 1 - Math.abs(state.fixtureError) / 0.085)
  );
  dom.torchSignal.style.opacity = String(
    Math.max(0.2, 1 - Math.abs(state.torchError) / 0.085)
  );

  dom.countdownRing.style.strokeDashoffset = String(263.9 * (1 - countdownProgress));
  dom.countdownValue.textContent =
    state.phase === "countdown"
      ? state.countdown
      : state.phase === "welding"
        ? `${Math.round(state.weldProgress * 100)}`
        : state.phase === "complete"
          ? "✓"
          : state.phase === "failed"
            ? "!"
            : state.phase === "success"
              ? "✓"
              : state.phase === "align"
                ? "0"
                : "—";

  dom.roundLabel.textContent = state.phase === "success"
    ? "批次完成 / 03"
    : `批次 ${String(Math.min(state.round, 3)).padStart(2, "0")} / 03`;
  dom.syncFill.style.width = `${syncPercent}%`;
  dom.syncValue.textContent = `${String(syncPercent).padStart(2, "0")}%`;

  if (state.phase === "align" && state.inTolerance) {
    dom.stateKicker.textContent = "TARGET CAPTURED";
    dom.stateTitle.textContent = "两侧已进入定位带";
    dom.stateHint.textContent = "同时按住 F + J，开始同步焊接";
  } else if (state.phase === "failed" && state.failure) {
    dom.stateKicker.textContent = copy.kicker;
    dom.stateTitle.textContent = state.failure.title;
    dom.stateHint.textContent = state.failure.text;
  } else if (state.phase === "complete") {
    dom.stateKicker.textContent = copy.kicker;
    dom.stateTitle.textContent = `第 ${state.completed} 组装配完成`;
    dom.stateHint.textContent = state.completed >= 3
      ? "正在确认备件保留状态"
      : copy.hint;
  } else if (state.phase === "success") {
    dom.stateKicker.textContent = copy.kicker;
    dom.stateTitle.textContent = copy.title;
    dom.stateHint.textContent = copy.hint;
  } else {
    dom.stateKicker.textContent = copy.kicker;
    dom.stateTitle.textContent = copy.title;
    dom.stateHint.textContent = copy.hint;
  }

  dom.bannerText.textContent =
    state.phase === "align" && state.inTolerance
      ? "两侧定位锁定 · 同时按住 F + J 开始焊接"
      : copy.banner;
  dom.phaseBanner.classList.toggle("is-danger", state.phase === "failed");

  dom.groupLights.forEach((light, index) => {
    light.classList.toggle("is-complete", index < state.completed);
  });
  dom.groupLights[0]?.parentElement?.setAttribute(
    "aria-label",
    `装配进度 ${state.completed}/3`
  );
  dom.spareCount.textContent = String(state.spares);
  dom.spareStack.forEach((node, index) => {
    node.classList.toggle("is-spent", index >= state.spares);
  });

  if (state.phase === "failed" && state.failure) {
    dom.resultPanel.hidden = false;
    dom.resultPanel.classList.remove("is-success");
    dom.resultCode.textContent = state.failure.code;
    dom.resultTitle.textContent = state.failure.title;
    dom.resultText.textContent = `${state.failure.text} 单侧操作不会推进完成数。`;
    dom.resultAction.textContent = "重新装料";
    dom.resultAction.dataset.action = "reset";
  } else if (state.phase === "success") {
    dom.resultPanel.hidden = false;
    dom.resultPanel.classList.add("is-success");
    dom.resultCode.textContent = "MISSION COMPLETE";
    dom.resultTitle.textContent = "三组装配完成";
    dom.resultText.textContent = `三组焊缝全部通过。两套备件完整保留，批次可交付。`;
    dom.resultAction.textContent = "再跑一批";
    dom.resultAction.dataset.action = "reset";
  } else {
    dom.resultPanel.hidden = true;
  }

  const seconds = Math.floor((performance.now() - startedAt) / 1000);
  dom.sessionClock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function handleEngineEvent(event) {
  if (event.type === "fail") {
    flashScreen();
    lastFailure = event.code;
  }
  audio.pulse(event.type, event);
  if (event.type === "round-start") {
    lastFailure = null;
  }
}

function frame(now) {
  const delta = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  engine.update(delta);
  const state = engine.snapshot();

  engine.consumeEvents().forEach(handleEngineEvent);
  updateUi(state);
  audio.update(state.sync, state.phase, state.vibration);
  renderer.draw(state, now / 1000, audio.waveform(72));

  if (state.phase !== lastPhase) lastPhase = state.phase;
  requestAnimationFrame(frame);
}

const trimKeys = new Set(["KeyA", "KeyD", "ArrowLeft", "ArrowRight"]);

window.addEventListener("keydown", (event) => {
  if (trimKeys.has(event.code)) {
    event.preventDefault();
    activeKeys.add(event.code);
    updateTrimFromKeys();
    audio.start();
    return;
  }

  if (event.code === "KeyF") {
    event.preventDefault();
    if (!event.repeat) pressTrigger("fixture");
    audio.start();
    return;
  }

  if (event.code === "KeyJ") {
    event.preventDefault();
    if (!event.repeat) pressTrigger("torch");
    audio.start();
  }
});

window.addEventListener("keyup", (event) => {
  if (trimKeys.has(event.code)) {
    activeKeys.delete(event.code);
    updateTrimFromKeys();
  }
  if (event.code === "KeyF") releaseTrigger("fixture");
  if (event.code === "KeyJ") releaseTrigger("torch");
});

document.querySelectorAll("[data-trim]").forEach((button) => {
  const [side, direction] = button.dataset.trim.split(":");

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    audio.start();
    button.setPointerCapture?.(event.pointerId);
    pointerTrims.set(event.pointerId, { side, direction: Number(direction) });
    button.classList.add("is-active");
    updateTrimFromKeys();
  });

  const release = (event) => {
    pointerTrims.delete(event.pointerId);
    button.classList.remove("is-active");
    updateTrimFromKeys();
  };
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
});

Object.entries(dom.triggerButtons).forEach(([side, button]) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    pressTrigger(side);
  });

  const release = () => releaseTrigger(side);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", release);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
});

dom.soundToggle.addEventListener("click", async () => {
  soundEnabled = !soundEnabled;
  dom.soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  audio.setEnabled(soundEnabled);
  if (soundEnabled) await audio.start();
});

dom.resetButton.addEventListener("click", resetRun);
dom.resultAction.addEventListener("click", resetRun);

window.addEventListener("pointerdown", () => audio.start(), {
  capture: true,
  once: true
});
window.addEventListener("keydown", () => audio.start(), {
  capture: true,
  once: true
});

window.addEventListener("blur", () => {
  activeKeys.clear();
  updateTrimFromKeys();
  Object.keys(dom.triggerButtons).forEach((side) => {
    if (engine.held[side]) releaseTrigger(side);
  });
});

window.addEventListener("visibilitychange", () => {
  lastFrame = performance.now();
});

window.__SYNCWELD__ = {
  getState: () => engine.snapshot(),
  getEvents: () => engine.consumeEvents(),
  reset: resetRun,
  pressTrigger,
  releaseTrigger,
  engine,
  audio
};

requestAnimationFrame(frame);
