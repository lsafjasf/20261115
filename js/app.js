import {
  DT,
  WORLD,
  cloneState,
  createInitialState,
  snapshotState,
  stepSimulation
} from "./physics.js";
import { RunRecorder, snapshotDigest, verifyReplay } from "./recording.js";
import { createDemoController } from "./autopilot.js";
import { GameRenderer } from "./renderer.js";
import { TensionAudio } from "./audio.js";

const $ = (selector) => document.querySelector(selector);
const canvas = $("#gameCanvas");
const renderer = new GameRenderer(canvas);
const audio = new TensionAudio();

const keyState = Object.create(null);
const CONTROL_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "Space",
  "KeyP",
  "Period"
]);

let state = createInitialState();
let recorder = new RunRecorder(state);
let mode = "live";
let paused = false;
let lastFrameTime = performance.now();
let accumulator = 0;
let lastInput = { throttle: 0, steer: 0, anchor: false, payout: 0 };
let currentRun = {
  initial: cloneState(state),
  frames: recorder.frames,
  demo: false
};
let replay = {
  initial: null,
  frames: [],
  index: 0,
  simulation: null,
  accumulator: 0,
  complete: false,
  demo: false,
  verification: null
};
let verifyResult = null;
let audioReady = false;
let muted = false;
let gateMilestones = [null, null];

const ui = {
  runStatus: $("#runStatus"),
  statusText: $("#statusText"),
  runClock: $("#runClock"),
  gateSummary: $("#gateSummary"),
  cableState: $("#cableState"),
  recordState: $("#recordState"),
  timelineFill: $("#timelineFill"),
  timelineThumb: $("#timelineThumb"),
  timelineMeta: $("#timelineMeta"),
  gateMarkers: [...document.querySelectorAll(".timeline-gate")],
  pauseBtn: $("#pauseBtn"),
  stepBtn: $("#stepBtn"),
  replayBtn: $("#replayBtn"),
  demoBtn: $("#demoBtn"),
  resetBtn: $("#resetBtn"),
  muteBtn: $("#muteBtn"),
  tensionValue: $("#tensionValue"),
  tensionLabel: $("#tensionLabel"),
  tensionFill: $("#tensionFill"),
  cableLengthValue: $("#cableLengthValue"),
  lengthFill: $("#lengthFill"),
  damageValue: $("#damageValue"),
  damageFill: $("#damageFill"),
  pitchValue: $("#pitchValue"),
  audioWave: $(".audio-wave"),
  missionCount: $("#missionCount"),
  missionItems: [...document.querySelectorAll("#missionList li")],
  verifyCard: $("#verifyCard"),
  verifyIcon: $("#verifyIcon"),
  verifyTitle: $("#verifyTitle"),
  verifyBody: $("#verifyBody"),
  resultCard: $("#resultCard"),
  resultKicker: $("#resultKicker"),
  resultTitle: $("#resultTitle"),
  resultBody: $("#resultBody"),
  resultReplay: $("#resultReplay"),
  resultReset: $("#resultReset"),
  inputLog: $("#inputLog"),
  keyCaps: [...document.querySelectorAll("kbd[data-key]")]
};

function readKeyboardInput() {
  return {
    throttle: Number(Boolean(keyState.KeyW)) - Number(Boolean(keyState.KeyS)),
    steer: Number(Boolean(keyState.KeyD)) - Number(Boolean(keyState.KeyA)),
    payout: Number(Boolean(keyState.ArrowUp)) - Number(Boolean(keyState.ArrowDown)),
    anchor: Boolean(keyState.Space)
  };
}

function inputHasActivity(input) {
  return Boolean(input.throttle || input.steer || input.anchor || input.payout);
}

function rememberInput(input) {
  if (inputHasActivity(input)) lastInput = { ...input };
  return lastInput;
}

async function startAudio() {
  if (audioReady) return;
  audioReady = true;
  try {
    await audio.ensure();
  } catch {
    audioReady = false;
  }
}

function recordStep(input) {
  stepSimulation(state, input);
  recorder.record(input, state);
  if (state.status !== "live") {
    pauseClock();
  }
}

function advanceLiveOneStep() {
  if (mode !== "live" || state.status !== "live") return;
  const input = rememberInput(readKeyboardInput());
  recordStep(input);
  updateGateMilestones();
}

function tick(now) {
  const frameSeconds = Math.min(0.1, Math.max(0, (now - lastFrameTime) / 1000));
  lastFrameTime = now;

  if (mode === "live" && !paused && state.status === "live") {
    accumulator += frameSeconds;
    let guard = 0;
    while (accumulator >= DT && guard < 12) {
      advanceLiveOneStep();
      accumulator -= DT;
      guard += 1;
    }
  } else if (mode === "replay" && !paused && replay.index < replay.frames.length) {
    replay.accumulator += frameSeconds;
    let guard = 0;
    while (replay.accumulator >= DT && replay.index < replay.frames.length && guard < 16) {
      replay.accumulator -= DT;
      advanceReplayOneFrame();
      guard += 1;
    }
    if (replay.index >= replay.frames.length) finishReplay();
  } else {
    accumulator = 0;
  }

  render(now / 1000);
  requestAnimationFrame(tick);
}

function render(visualTime) {
  const displayState = mode === "replay" && replay.simulation ? replay.simulation : state;
  renderer.render(displayState, {
    mode: mode === "replay" ? "replay" : "live",
    visualTime
  });
  updateInterface(displayState);
}

function pauseClock() {
  paused = true;
  if (state.status === "live") mode = "paused";
}

function resumeClock() {
  if (state.status !== "live" && mode !== "replay") return;
  if (mode === "replay" && replay.complete) return;
  paused = false;
  mode = mode === "paused" ? "live" : mode;
}

function updateGateMilestones() {
  for (let index = 0; index < 2; index += 1) {
    if (
      gateMilestones[index] === null &&
      state.cars.every((car) => car.gates[index])
    ) {
      gateMilestones[index] = state.step;
    }
  }
}

function milestonesFromFrames(frames) {
  const milestones = [null, null];
  for (const frame of frames) {
    for (let index = 0; index < 2; index += 1) {
      if (
        milestones[index] === null &&
        frame.snapshot.cars.every((car) => car.gates[index])
      ) {
        milestones[index] = frame.step;
      }
    }
  }
  return milestones;
}

function setVerifyState(kind, result = null) {
  ui.verifyCard.dataset.state = kind;
  if (kind === "checking") {
    ui.verifyIcon.textContent = "◌";
    ui.verifyTitle.textContent = "正在重算轨迹";
    ui.verifyBody.textContent = "逐步重演双人输入与物理状态…";
    return;
  }
  if (kind === "pass" && result) {
    ui.verifyIcon.textContent = "✓";
    ui.verifyTitle.textContent = "回放轨迹一致";
    ui.verifyBody.textContent =
      `${result.steps} 帧 · 误差 ${formatError(result.maxError)} px · ${result.replayDigest}`;
    return;
  }
  if (kind === "fail" && result) {
    ui.verifyIcon.textContent = "!";
    ui.verifyTitle.textContent = "回放轨迹不一致";
    ui.verifyBody.textContent = `${result.mismatches} 处偏差 · 最大 ${formatError(result.maxError)} px`;
    return;
  }
  ui.verifyIcon.textContent = "◇";
  ui.verifyTitle.textContent = "尚未校验";
  ui.verifyBody.textContent = "完成一局后可重演全部输入与轨迹";
}

function formatError(value) {
  if (value === 0) return "0.000000";
  if (value < 0.000001) return value.toExponential(2);
  return value.toFixed(6);
}

function beginVerification(initial, frames) {
  setVerifyState("checking");
  const result = verifyReplay(initial, frames);
  verifyResult = result;
  window.setTimeout(() => {
    if (verifyResult === result) {
      setVerifyState(result.ok ? "pass" : "fail", result);
    }
  }, 180);
  return result;
}

function startReplay(initialState, frames, options = {}) {
  if (!frames.length) return;
  currentRun = {
    initial: cloneState(initialState),
    frames,
    demo: Boolean(options.demo)
  };
  replay = {
    initial: cloneState(initialState),
    frames,
    index: 0,
    simulation: cloneState(initialState),
    accumulator: 0,
    complete: false,
    demo: Boolean(options.demo),
    verification: beginVerification(initialState, frames)
  };
  gateMilestones = milestonesFromFrames(frames);
  mode = "replay";
  paused = false;
  accumulator = 0;
  ui.resultCard.hidden = true;
}

function advanceReplayOneFrame() {
  if (replay.index >= replay.frames.length) return;
  const frame = replay.frames[replay.index];
  stepSimulation(replay.simulation, frame.input);
  replay.index += 1;
  if (replay.index >= replay.frames.length) finishReplay();
}

function finishReplay() {
  if (replay.complete) return;
  replay.complete = true;
  paused = true;
  const finalState = replay.simulation;
  const passed = replay.verification?.ok;
  showResult(
    finalState.status === "success" ? "REPLAY COMPLETE" : "REPLAY COMPLETE",
    finalState.status === "success" ? "双车抵达终点" : "回放结束",
    passed
      ? `全部输入已重算，轨迹一致。最大误差 ${formatError(replay.verification.maxError)} px，摘要 ${replay.verification.replayDigest}。`
      : "回放重算出现偏差，请查看右侧校验信息。",
    passed ? "pass" : "fail"
  );
}

function showResult(kicker, title, body, stateName = "pass") {
  ui.resultKicker.textContent = kicker;
  ui.resultTitle.textContent = title;
  ui.resultBody.textContent = body;
  ui.resultCard.dataset.state = stateName;
  ui.resultCard.hidden = false;
}

function finishLiveRun() {
  if (state.status === "success") {
    verifyResult = beginVerification(currentRun.initial, recorder.frames);
    showResult(
      "BOTH VEHICLES CLEAR",
      "双车抵达终点",
      `两车通过全部闸门。已记录 ${recorder.stepCount} 帧双人输入与物理状态，可整局回放校验。`,
      "pass"
    );
  } else if (state.status === "failed") {
    showResult(
      "TETHER OVERLOAD",
      "车体损毁",
      `缆绳张力超过车体极限。运行记录保留 ${recorder.stepCount} 帧，可回放查看过载过程。`,
      "fail"
    );
  }
}

function generateDemoRun() {
  const initial = createInitialState();
  const simulation = cloneState(initial);
  const demoRecorder = new RunRecorder(initial);
  const controller = createDemoController();
  let guard = 0;

  while (simulation.status === "live" && guard < 900) {
    const input = controller(simulation);
    stepSimulation(simulation, input);
    demoRecorder.record(input, simulation);
    guard += 1;
  }
  return {
    initial,
    frames: demoRecorder.frames,
    finalState: simulation,
    recorder: demoRecorder
  };
}

function playDemo() {
  const demo = generateDemoRun();
  startReplay(demo.initial, demo.frames, { demo: true });
}

function resetGame() {
  state = createInitialState();
  recorder = new RunRecorder(state);
  currentRun = { initial: cloneState(state), frames: recorder.frames, demo: false };
  mode = "live";
  paused = false;
  accumulator = 0;
  replay = {
    initial: null,
    frames: [],
    index: 0,
    simulation: null,
    accumulator: 0,
    complete: false,
    demo: false,
    verification: null
  };
  verifyResult = null;
  gateMilestones = [null, null];
  ui.resultCard.hidden = true;
  setVerifyState("idle");
  for (const key of Object.keys(keyState)) keyState[key] = false;
  updateKeyCaps({});
}

function togglePause() {
  if (mode === "live" && state.status === "live") {
    paused = true;
    mode = "paused";
    return;
  }
  if (mode === "paused" && state.status === "live") {
    paused = false;
    mode = "live";
    return;
  }
  if (mode === "replay" && !replay.complete) {
    paused = !paused;
    return;
  }
  if (mode === "replay" && replay.complete) {
    startReplay(replay.initial, replay.frames, { demo: replay.demo });
  }
}

function singleStep() {
  if (!paused) return;
  startAudio();
  if (mode === "replay" && !replay.complete) {
    advanceReplayOneFrame();
    return;
  }
  if (mode === "paused" && state.status === "live") {
    const input = rememberInput(readKeyboardInput());
    recordStep(input);
    updateGateMilestones();
  }
}

function formatClock(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  const whole = Math.floor(rest);
  const millis = Math.floor((rest - whole) * 1000);
  return `${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function displayedInput() {
  if (mode === "replay") {
    const index = Math.max(0, Math.min(replay.frames.length - 1, replay.index - 1));
    return replay.frames[index]?.input || lastInput;
  }
  const keyboardInput = readKeyboardInput();
  if (inputHasActivity(keyboardInput)) return keyboardInput;
  if (state.status !== "live") return lastInput;
  return keyboardInput;
}

function updateKeyCaps(input) {
  const active = new Set();
  if (input.throttle > 0) active.add("KeyW");
  if (input.throttle < 0) active.add("KeyS");
  if (input.steer < 0) active.add("KeyA");
  if (input.steer > 0) active.add("KeyD");
  if (input.payout > 0) active.add("ArrowUp");
  if (input.payout < 0) active.add("ArrowDown");
  if (input.anchor) active.add("Space");
  ui.keyCaps.forEach((keyCap) => {
    keyCap.classList.toggle("active", active.has(keyCap.dataset.key));
  });
}

function describeInput(input) {
  const p1 = [];
  const p2 = [];
  if (input.throttle > 0) p1.push("W");
  if (input.throttle < 0) p1.push("S");
  if (input.steer < 0) p1.push("A");
  if (input.steer > 0) p1.push("D");
  if (input.payout > 0) p2.push("↑放缆");
  if (input.payout < 0) p2.push("↓收缆");
  if (input.anchor) p2.push("SPACE锚定");
  if (!p1.length && !p2.length) return "待机";
  return `P1 ${p1.join("+") || "—"} · P2 ${p2.join("+") || "—"}`;
}

function updateTimeline(displayState) {
  const replaying = mode === "replay";
  const endedRun = !replaying && state.status !== "live";
  const total = replaying
    ? Math.max(1, replay.frames.length)
    : endedRun
      ? Math.max(1, recorder.stepCount)
      : Math.max(600, state.step);
  const current = replaying ? replay.index : displayState.step;
  const percentage = Math.min(100, Math.max(0, (current / total) * 100));

  ui.timelineFill.style.width = `${percentage}%`;
  ui.timelineThumb.style.left = `${percentage}%`;
  if (replaying) {
    ui.timelineMeta.textContent = `${replay.index} / ${replay.frames.length} 帧 · 重算回放`;
  } else {
    ui.timelineMeta.textContent = `${recorder.stepCount} 帧 / 120 Hz`;
  }

  ui.gateMarkers.forEach((marker, index) => {
    const milestone = gateMilestones[index];
    if (milestone === null) {
      marker.style.display = "none";
      return;
    }
    marker.style.display = "";
    marker.style.left = `${Math.min(100, (milestone / total) * 100)}%`;
  });
}

function updateMissions(displayState) {
  let completeCount = 0;
  ui.missionItems.forEach((item) => {
    let complete = false;
    if (item.dataset.gate) {
      const [carIndex, gateIndex] = item.dataset.gate.split("-").map(Number);
      complete = Boolean(displayState.cars[carIndex]?.gates[gateIndex]);
    } else {
      complete = displayState.cars.every((car) => car.finished);
    }
    item.classList.toggle("complete", complete);
    item.querySelector("b").textContent = complete ? "已完成" : item.dataset.finish ? "待抵达" : "待通过";
    if (complete) completeCount += 1;
  });
  ui.missionCount.textContent = `${completeCount} / 5`;
}

function updateInterface(displayState) {
  const tension = displayState.cable.tension || 0;
  const damage = Math.max(...displayState.cars.map((car) => car.damage));
  const input = displayedInput();
  const replaying = mode === "replay";
  const ended = displayState.status !== "live";
  let statusText = "等待操作";
  let statusKind = "live";

  if (displayState.status === "success") {
    statusText = "任务完成";
    statusKind = "success";
  } else if (displayState.status === "failed") {
    statusText = "车体损毁";
    statusKind = "failed";
  } else if (replaying) {
    statusText = replay.complete ? "回放完成" : paused ? "回放暂停" : "输入重算回放";
    statusKind = "replay";
  } else if (paused) {
    statusText = "已暂停";
    statusKind = "paused";
  } else if (inputHasActivity(input)) {
    statusText = "协作进行中";
  }

  ui.runStatus.dataset.state = statusKind;
  ui.statusText.textContent = statusText;
  ui.runClock.textContent = formatClock(displayState.elapsed);
  ui.gateSummary.textContent = `闸门 ${displayState.gatePasses} / 4`;

  let cableLabel = "缆绳松弛";
  if (tension > 1200) cableLabel = "危险过载";
  else if (tension > 850) cableLabel = "过载损伤";
  else if (tension >= 280) cableLabel = "传力正常";
  else if (tension >= 80) cableLabel = "弱传力";
  ui.cableState.textContent = cableLabel;

  if (replaying) {
    ui.recordState.textContent = replay.complete ? "◆ VERIFIED REPLAY" : "▶ RECORDED REPLAY";
    ui.recordState.classList.remove("recording");
  } else if (ended) {
    ui.recordState.textContent = "■ RUN SAVED";
    ui.recordState.classList.remove("recording");
  } else if (paused) {
    ui.recordState.textContent = "Ⅱ RECORD PAUSED";
    ui.recordState.classList.remove("recording");
  } else {
    ui.recordState.textContent = "● REC";
    ui.recordState.classList.add("recording");
  }

  ui.tensionValue.textContent = Math.round(tension).toLocaleString("en-US");
  ui.tensionFill.style.width = `${Math.min(100, (tension / 1600) * 100)}%`;
  let tensionLabel = "松弛";
  if (tension > 1200) tensionLabel = "危险";
  else if (tension > 850) tensionLabel = "过载";
  else if (tension >= 280) tensionLabel = "稳定传力";
  else if (tension >= 80) tensionLabel = "弱传力";
  ui.tensionLabel.textContent = tensionLabel;
  ui.tensionLabel.style.color =
    tension > 850 ? "var(--red)" : tension >= 280 ? "var(--cyan)" : "var(--muted)";
  ui.cableLengthValue.textContent = displayState.cable.target.toFixed(0);
  ui.lengthFill.style.width = `${Math.max(2, Math.min(100, ((displayState.cable.target - 92) / 198) * 100))}%`;
  ui.damageValue.textContent = damage.toFixed(damage >= 10 ? 0 : 1);
  ui.damageFill.style.width = `${Math.min(100, damage)}%`;
  ui.damageValue.style.color = damage > 45 ? "var(--red)" : "";

  const runningAudio = !paused && !ended;
  const frequency = audio.update(tension, runningAudio ? "live" : "paused");
  ui.pitchValue.textContent = audioReady ? `${Math.round(frequency)} Hz` : "-- Hz";
  ui.audioWave.classList.toggle("active", runningAudio && !muted);

  updateMissions(displayState);
  updateTimeline(displayState);
  updateKeyCaps(input);
  ui.inputLog.textContent = `输入记录：${describeInput(input)}`;

  ui.pauseBtn.textContent = (paused || replay.complete) && !ended ? "继续" : "暂停";
  ui.pauseBtn.disabled = ended || replay.complete;
  ui.stepBtn.disabled = !paused || ended || (replaying && replay.complete);
  ui.replayBtn.textContent = replaying && replay.complete ? "再次回放" : "回放并校验";
  ui.replayBtn.disabled = currentRun.frames.length === 0;
  ui.demoBtn.disabled = false;
  ui.muteBtn.dataset.muted = muted ? "true" : "false";
  ui.muteBtn.textContent = muted ? "静" : "声";

  if (!replaying && ended && ui.resultCard.hidden) {
    finishLiveRun();
  }
}

window.addEventListener("keydown", (event) => {
  if (CONTROL_KEYS.has(event.code)) event.preventDefault();
  if (!CONTROL_KEYS.has(event.code)) return;
  startAudio();
  keyState[event.code] = true;

  if (event.code === "KeyP" && !event.repeat) {
    togglePause();
  }
  if (event.code === "Period" && !event.repeat) {
    singleStep();
  }
});

window.addEventListener("keyup", (event) => {
  if (!CONTROL_KEYS.has(event.code)) return;
  event.preventDefault();
  keyState[event.code] = false;
});

window.addEventListener("blur", () => {
  for (const key of Object.keys(keyState)) keyState[key] = false;
});

ui.pauseBtn.addEventListener("click", () => {
  startAudio();
  togglePause();
});

ui.stepBtn.addEventListener("click", singleStep);

ui.replayBtn.addEventListener("click", () => {
  startAudio();
  if (currentRun.frames.length) {
    startReplay(currentRun.initial, currentRun.frames, { demo: currentRun.demo });
  }
});

ui.demoBtn.addEventListener("click", () => {
  startAudio();
  playDemo();
});

ui.resetBtn.addEventListener("click", resetGame);
ui.resultReplay.addEventListener("click", () => {
  if (currentRun.frames.length) {
    startReplay(currentRun.initial, currentRun.frames, { demo: currentRun.demo });
  }
});
ui.resultReset.addEventListener("click", resetGame);

ui.muteBtn.addEventListener("click", async () => {
  await startAudio();
  muted = !muted;
  audio.setMuted(muted);
});

document.addEventListener("pointerdown", startAudio, { once: true });

window.__TETHER__ = {
  getSnapshot() {
    return snapshotState(mode === "replay" && replay.simulation ? replay.simulation : state);
  },
  getMode() {
    return mode;
  },
  getFrameCount() {
    return currentRun.frames.length;
  },
  getReplayIndex() {
    return replay.index;
  },
  getVerification() {
    return verifyResult;
  },
  getTimeline() {
    return {
      mode,
      paused,
      recorderSteps: recorder.stepCount,
      replayFrames: replay.frames.length,
      replayIndex: replay.index,
      gates: gateMilestones
    };
  },
  startDemo: playDemo,
  startReplay() {
    if (currentRun.frames.length) {
      startReplay(currentRun.initial, currentRun.frames, { demo: currentRun.demo });
    }
  },
  reset: resetGame,
  pause: togglePause,
  step: singleStep,
  generateAndVerifyDemo() {
    const demo = generateDemoRun();
    const verification = verifyReplay(demo.initial, demo.frames);
    return {
      status: demo.finalState.status,
      step: demo.finalState.step,
      gatePasses: demo.finalState.gatePasses,
      cars: snapshotState(demo.finalState).cars,
      verification
    };
  }
};

setVerifyState("idle");
requestAnimationFrame(tick);
