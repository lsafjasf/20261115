import { WindAudio } from "./audio.js";
import { SceneRenderer } from "./render.js";
import {
  CHECKPOINTS,
  LIMITS,
  WORLD,
  autopilotPitch,
  createFlight,
  runSimulation,
  setPitchCommand,
  settingsFrom,
  stepFlight,
  terrainAt,
  windAt,
  windZoneAt,
} from "./sim.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const DEG = Math.PI / 180;

const ui = {
  canvas: $("#flightCanvas"),
  canvasShell: $("#canvasShell"),
  span: $("#spanControl"),
  spanValue: $("#spanValue"),
  aspectValue: $("#aspectValue"),
  cg: $("#cgControl"),
  cgValue: $("#cgValue"),
  cgMarker: $("#cgMarker"),
  cgHint: $("#cgHint"),
  pitch: $("#pitchControl"),
  pitchValue: $("#pitchValue"),
  trimState: $("#trimState"),
  launch: $("#launchButton"),
  demo: $("#demoButton"),
  compareSetup: $("#compareSetupButton"),
  reset: $("#resetButton"),
  audio: $("#audioButton"),
  audioLabel: $("#audioLabel"),
  statusChip: $("#statusChip"),
  statusText: $("#statusText"),
  flightTime: $("#flightTime"),
  windSpeed: $("#windSpeed"),
  windArrow: $("#windArrow"),
  windDirection: $("#windDirection"),
  windZoneName: $("#windZoneName"),
  airSpeed: $("#airSpeed"),
  altitude: $("#altitude"),
  agl: $("#agl"),
  sinkRate: $("#sinkRate"),
  alphaValue: $("#alphaValue"),
  speedMeter: $("#speedMeter"),
  coach: $("#coach"),
  coachTitle: $("#coachTitle"),
  coachText: $("#coachText"),
  routeDetail: $("#routeDetail"),
  resultCard: $("#resultCard"),
  resultKicker: $("#resultKicker"),
  resultTitle: $("#resultTitle"),
  resultText: $("#resultText"),
  resultAction: $("#resultAction"),
  recordA: $("#recordA"),
  recordB: $("#recordB"),
  compareButton: $("#compareButton"),
  modeTabs: $$(".mode-tab"),
  playControls: $("#playControls"),
  playButton: $("#playButton"),
  replayTime: $("#replayTime"),
  replayDuration: $("#replayDuration"),
  timeline: $("#timeline"),
  consoleMode: $("#consoleMode"),
  routeNodes: $$(".route-node"),
};

const renderer = new SceneRenderer(ui.canvas);
const audio = new WindAudio();

const app = {
  settings: settingsFrom(),
  flight: createFlight(settingsFrom()),
  mode: "live",
  autoPilot: false,
  simRate: 1,
  accumulator: 0,
  lastFrame: performance.now(),
  records: { A: null, B: null },
  replaySlot: "A",
  playback: {
    time: 0,
    duration: 1,
    playing: false,
    rate: 1,
  },
  completed: false,
  selectionLocked: false,
};

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(1).padStart(4, "0")}`;
}

function signed(value, digits = 1) {
  const rounded = Number(value).toFixed(digits);
  if (Number(rounded) === 0) return "0";
  return rounded.replace("-", "−");
}

function initialSignature(flight) {
  if (!flight) return "";
  return `${Number(flight.settings.cg).toFixed(2)}|${Number(flight.settings.pitch).toFixed(1)}`;
}

function isSameInitial(a, b) {
  return Boolean(a && b && initialSignature(a) === initialSignature(b));
}

function markRecordLabels() {
  if (app.records.A) app.records.A.recordLabel = "A";
  if (app.records.B) app.records.B.recordLabel = "B";
}

function currentFrameFlight() {
  if (app.mode === "replay") {
    return app.records[app.replaySlot] ?? null;
  }
  return app.flight;
}

function sampleFlight(flight, time) {
  if (!flight) return null;
  if (!flight.trail?.length) return { ...flight, speed: flight.speed, groundSpeed: flight.groundSpeed, pitch: flight.pitch / DEG };
  const trail = flight.trail;
  const fixedTime = clamp(time, 0, trail.at(-1).time);
  if (fixedTime <= trail[0].time) return { ...trail[0], status: flight.status, wind: windAt(trail[0].y, fixedTime) };
  if (fixedTime >= trail.at(-1).time) {
    const last = trail.at(-1);
    return { ...last, status: flight.status, wind: windAt(last.y, fixedTime) };
  }
  for (let index = 1; index < trail.length; index += 1) {
    const right = trail[index];
    if (right.time < fixedTime) continue;
    const left = trail[index - 1];
    const mix = (fixedTime - left.time) / Math.max(0.0001, right.time - left.time);
    return {
      x: left.x + (right.x - left.x) * mix,
      y: left.y + (right.y - left.y) * mix,
      speed: left.speed + (right.speed - left.speed) * mix,
      groundSpeed: left.groundSpeed + (right.groundSpeed - left.groundSpeed) * mix,
      pitch: left.pitch + (right.pitch - left.pitch) * mix,
      gamma: left.gamma + (right.gamma - left.gamma) * mix,
      alpha: left.alpha + (right.alpha - left.alpha) * mix,
      windX: left.windX,
      windY: left.windY,
      wind: windAt(left.y + (right.y - left.y) * mix, fixedTime),
      status: flight.status,
    };
  }
  return { ...trail.at(-1), status: flight.status, wind: windAt(trail.at(-1).y, fixedTime) };
}

function syncControls() {
  const { span, cg, pitch } = app.settings;
  ui.span.value = span.toFixed(2);
  ui.cg.value = cg.toFixed(0);
  ui.pitch.value = pitch.toFixed(1);
  ui.spanValue.textContent = span.toFixed(2);
  ui.aspectValue.textContent = (span / 0.85).toFixed(1);
  ui.cgValue.textContent = `${signed(cg, 0)}% MAC`;
  ui.pitchValue.textContent = `${signed(pitch, 1)}°`;
  ui.cgMarker.style.left = `${((cg + 12) / 24) * 100}%`;
  ui.cgHint.textContent = cg < -6 ? "稳定 / 阻力增加" : cg > 6 ? "灵敏 / 低速风险" : "稳定";

  if (pitch < -23) {
    ui.trimState.textContent = "俯冲增速";
    ui.trimState.style.color = "var(--orange-dark)";
  } else if (pitch > -12) {
    ui.trimState.textContent = "接近失速";
    ui.trimState.style.color = "var(--orange-dark)";
  } else {
    ui.trimState.textContent = "滑翔效率良好";
    ui.trimState.style.color = "";
  }
}

function displayState() {
  if (app.mode === "replay") {
    const flight = app.records[app.replaySlot];
    return {
      flight,
      sample: flight ? sampleFlight(flight, app.playback.time) : app.flight,
    };
  }
  if (app.mode === "compare") {
    const flight = app.records.A;
    return {
      flight,
      sample: flight ? sampleFlight(flight, app.playback.time) : app.flight,
    };
  }
  return {
    flight: app.flight,
    sample: app.flight,
  };
}

function updateStatusUi(state) {
  const flight = state.flight ?? app.flight;
  let label = "待放飞";
  let className = "status-chip";

  if (app.mode === "compare") {
    label = "A / B 同步回放";
    className += " is-flying";
  } else if (app.mode === "replay") {
    label = `回放 · ${app.replaySlot}`;
    className += " is-flying";
  } else if (flight.status === "flying") {
    label = app.autoPilot ? "示范飞行中" : "飞行中";
    className += " is-flying";
  } else if (flight.status === "success") {
    label = "安全降落";
    className += " is-success";
  } else if (flight.status === "failed") {
    label = "试验中止";
    className += " is-failed";
  }

  ui.statusChip.className = className;
  ui.statusText.textContent = label;

  const time = app.mode === "live" ? flight.time : app.playback.time;
  ui.flightTime.textContent = formatTime(time);
}

function updateTelemetry(sample) {
  if (!sample) return;
  const wind = sample.wind ?? windAt(sample.y, sample.time ?? 0);
  const windMagnitude = Math.hypot(wind.x, wind.y);
  const zone = windZoneAt(sample.y);
  const angle = Math.atan2(-wind.y, wind.x) / DEG;
  const speed = sample.speed ?? 0;
  const altitude = sample.y ?? WORLD.startAlt;
  const ground = terrainAt(sample.x ?? WORLD.startX);
  const gamma = sample.gamma ?? -18;
  const sink = app.mode === "live"
    ? Math.abs(app.flight.sinkRate || 0)
    : Math.abs(speed * Math.sin(gamma * DEG) + wind.y);
  const alpha = sample.alpha ?? 5;

  ui.windSpeed.textContent = windMagnitude.toFixed(1);
  ui.windArrow.style.transform = `rotate(${angle}deg)`;
  ui.windDirection.textContent = wind.x < -0.2 ? "E → W" : "W → E";
  ui.windZoneName.textContent = zone.name;
  ui.airSpeed.textContent = speed.toFixed(1);
  ui.altitude.textContent = altitude.toFixed(0);
  ui.agl.textContent = Math.max(0, altitude - ground).toFixed(0);
  ui.sinkRate.textContent = sink.toFixed(1);
  ui.alphaValue.textContent = signed(alpha, 1);
  ui.speedMeter.style.width = `${clamp(speed / 42, 0.05, 1) * 100}%`;
  ui.speedMeter.style.background = speed > 34 || alpha > 13 ? "var(--orange)" : "var(--cyan)";
}

function updateRoute(state) {
  const flight = state.flight ?? app.flight;
  const marks = flight.checkpointMarks ?? [];
  const playbackMode = app.mode === "replay" || app.mode === "compare";
  const playbackTime = app.playback.time;
  const revealedMarks = playbackMode ? marks.filter((mark) => mark.time <= playbackTime) : marks;
  const allClear = playbackMode
    ? flight.status === "success" && playbackTime >= flight.time - 0.02
    : flight.status === "success";
  let activeIndex = 0;
  if (playbackMode) {
    if (playbackTime > 0.05) activeIndex = 1;
    activeIndex += revealedMarks.filter((mark) => mark.passed).length;
  } else if (flight.status === "flying") {
    activeIndex = Math.min(3, flight.checkpointIndex + 1);
  }
  if (allClear) activeIndex = 3;
  if (!playbackMode && flight.status === "failed") {
    activeIndex = Math.min(3, flight.checkpointIndex + 1);
  }

  ui.routeNodes.forEach((node, index) => {
    node.classList.remove("is-active", "is-complete");
    if (allClear) {
      node.classList.add("is-complete", "is-active");
    } else if (index < activeIndex) {
      node.classList.add("is-complete");
    } else if (index === activeIndex) {
      node.classList.add("is-active");
    }
  });

  if (app.mode === "compare") {
    ui.routeDetail.textContent = "同初值 · 仅翼展不同 · 两条轨迹按同一时钟回放";
  } else if (app.mode === "replay") {
    ui.routeDetail.textContent = `记录 ${app.replaySlot} · ${formatTime(flight.time)} · ${flight.reason || "飞行轨迹"}`;
  } else if (flight.status === "ready") {
    ui.routeDetail.textContent = "等待放飞 · 当前参数将锁定为初始条件";
  } else if (flight.status === "flying") {
    const next = CHECKPOINTS[flight.checkpointIndex];
    if (next) {
      ui.routeDetail.textContent = `下一检查点 · ${next.name} · x ${next.x} m · 高度容差 ±${next.tolerance} m`;
    } else {
      ui.routeDetail.textContent = `跑道 ${WORLD.runwayStart}–${WORLD.runwayEnd} m · 触地限制 ≤ ${LIMITS.touchdownSpeed} m/s`;
    }
  } else {
    ui.routeDetail.textContent = `${flight.reason} · ${formatTime(flight.time)}`;
  }
}

function updateCoach(state) {
  const flight = state.flight ?? app.flight;
  const sample = state.sample ?? app.flight;
  let visible = true;
  let icon = "↑";
  let title = "等待放飞";
  let text = "选择参数后释放，飞行中可用 ↑ ↓ 调整俯仰。";

  if (app.mode === "compare") {
    const a = app.records.A;
    const b = app.records.B;
    title = "同初值翼展对比";
    text = a && b
      ? `A ${a.settings.span.toFixed(2)} m · ${a.groundSpeed.toFixed(1)} m/s ｜ B ${b.settings.span.toFixed(2)} m · ${b.groundSpeed.toFixed(1)} m/s`
      : "正在生成两条同初值轨迹。";
    icon = "⇄";
  } else if (app.mode === "replay") {
    const record = app.records[app.replaySlot];
    visible = Boolean(record);
    icon = "▶";
    title = `记录 ${app.replaySlot} 回放`;
    text = record ? `${record.settings.span.toFixed(2)} m 翼展 · ${record.status === "success" ? "安全降落" : record.reason}` : "";
  } else if (flight.status === "flying") {
    icon = app.autoPilot ? "✦" : "↑";
    title = app.autoPilot ? "示范航线 · 自动配平" : "俯仰控制";
    if (sample.x > 905 && sample.y < 120) {
      icon = "↺";
      title = "跑道在前 · 拉平";
      text = `抬头减速至 ${LIMITS.touchdownSpeed} m/s 以下，保持绿线跑道。`;
    } else if (sample.speed > 33) {
      icon = "↓";
      title = "空速偏高";
      text = "轻拉俯仰，让轨迹变平并消耗速度。";
    } else if (sample.y > 312) {
      title = "ZONE 01 · 高空西风";
      text = "顺风会拉长航程，继续压低机头，锁定 CP01 高度带。";
    } else if (sample.y > 176) {
      title = "ZONE 02 · 切变逆风";
      text = "逆风会缩短地面航程，保持稳定迎角，不要追杆。";
    } else if (sample.y > 0) {
      title = "ZONE 03 · 谷地下沉";
      text = "下沉气流压低高度，预留至少 80 m 用于最后拉平。";
    }
  } else if (flight.status === "success") {
    visible = false;
  } else if (flight.status === "failed") {
    visible = false;
  }

  ui.coach.classList.toggle("is-hidden", !visible);
  ui.coach.querySelector(".coach-icon").textContent = icon;
  ui.coachTitle.textContent = title;
  ui.coachText.textContent = text;
}

function recordResultText(flight) {
  if (!flight) return "—";
  return flight.status === "success" ? "✓ LAND" : "✕ ABORT";
}

function updateRecordCard(slot, flight, active) {
  const card = ui[`record${slot}`];
  card.classList.toggle("is-active", active);
  card.classList.toggle(`is-${slot.toLowerCase()}`, true);
  const span = card.querySelector(".record-span");
  const detail = card.querySelector(".record-detail");
  const result = card.querySelector(".record-result");

  if (!flight) {
    result.textContent = "—";
    result.className = "record-result pending";
    return;
  }

  span.innerHTML = `${flight.settings.span.toFixed(2)} m <small>翼展</small>`;
  detail.textContent = flight.status === "success"
    ? `${formatTime(flight.time)} · TD ${flight.groundSpeed.toFixed(1)} m/s`
    : flight.reason;
  result.textContent = recordResultText(flight);
  result.className = `record-result ${flight.status === "success" ? "" : "failed"}`;
}

function updateRecords() {
  updateRecordCard("A", app.records.A, app.mode === "replay" ? app.replaySlot === "A" : app.mode === "compare");
  updateRecordCard("B", app.records.B, app.mode === "replay" ? app.replaySlot === "B" : app.mode === "compare");

  const canCompare = Boolean(app.records.A && app.records.B);
  const sameInitial = isSameInitial(app.records.A, app.records.B);
  ui.compareButton.disabled = !(canCompare && sameInitial);
  ui.compareButton.title = canCompare && !sameInitial
    ? "两条记录的初始重心或配平不同，请用 A/B 预设生成同初值比较"
    : "";
}

function updateControlsLock() {
  const flying = app.mode === "live" && app.flight.status === "flying";
  ui.span.disabled = flying;
  ui.cg.disabled = flying;
  ui.pitch.disabled = false;
  ui.launch.disabled = flying;
  ui.demo.disabled = flying;
  ui.compareSetup.disabled = flying;
  ui.launch.querySelector("span").textContent = flying
    ? "飞行中…"
    : app.flight.status === "ready"
      ? "放飞滑翔器"
      : "再次放飞";
}

function updateConsole() {
  const replayable = app.mode === "replay" || app.mode === "compare";
  ui.playControls.classList.toggle("is-enabled", replayable);
  ui.timeline.disabled = !replayable;
  ui.consoleMode.textContent = app.mode === "live"
    ? "LIVE TELEMETRY"
    : app.mode === "replay"
      ? `REPLAY ${app.replaySlot} / 1:1`
      : "OVERLAY / SAME INITIAL";

  if (replayable) {
    const duration = Math.max(0.1, app.playback.duration);
    app.playback.time = clamp(app.playback.time, 0, duration);
    ui.timeline.value = String((app.playback.time / duration) * 1000);
    ui.replayTime.textContent = formatTime(app.playback.time);
    ui.replayDuration.textContent = formatTime(duration);
    ui.playButton.textContent = app.playback.playing ? "Ⅱ" : "▶";
  } else {
    ui.replayTime.textContent = "00:00.0";
    ui.replayDuration.textContent = formatTime(app.flight.time);
    ui.timeline.value = "0";
  }
}

function updateUi() {
  const state = displayState();
  updateStatusUi(state);
  updateTelemetry(state.sample);
  updateRoute(state);
  updateCoach(state);
  updateControlsLock();
  updateRecords();
  updateConsole();
}

function setModeButtons() {
  ui.modeTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.mode === app.mode);
  });
}

function hideResult() {
  ui.resultCard.hidden = true;
}

function showResult(flight) {
  const success = flight.status === "success";
  ui.resultCard.hidden = false;
  ui.resultCard.classList.toggle("is-failure", !success);
  ui.resultKicker.textContent = success ? "TOUCHDOWN CONFIRMED" : "FLIGHT ABORTED";
  ui.resultTitle.textContent = success ? "安全降落" : flight.reason;
  ui.resultText.textContent = success
    ? `触地 ${flight.groundSpeed.toFixed(1)} m/s · ${formatTime(flight.time)} · 两个检查点均已通过。`
    : `x ${flight.x.toFixed(0)} m / 标高 ${flight.y.toFixed(0)} m · 检查轨迹与风区后重试。`;
  ui.resultAction.textContent = success ? "查看这条成功航线 →" : "回放失败轨迹 →";
}

function recordCompletedFlight(flight) {
  let slot = "A";
  if (!app.records.A) slot = "A";
  else if (!app.records.B) slot = "B";
  else slot = "A";
  app.lastRecordSlot = slot;
  app.records[slot] = flight;
  app.replaySlot = slot;
  markRecordLabels();
  return slot;
}

function resetToLiveFlight() {
  app.mode = "live";
  app.flight = createFlight(settingsFrom(app.settings));
  app.autoPilot = false;
  app.simRate = 1;
  app.accumulator = 0;
  app.completed = false;
  app.playback.playing = false;
  hideResult();
  setModeButtons();
  updateUi();
}

function launchFlight({ auto = false, rate = 1 } = {}) {
  if (app.flight.status === "flying") return;
  app.flight = createFlight(settingsFrom(app.settings));
  app.flight.status = "flying";
  app.flight.recordLabel = "";
  app.mode = "live";
  app.autoPilot = auto;
  app.simRate = rate;
  app.accumulator = 0;
  app.completed = false;
  app.playback.playing = false;
  hideResult();
  setModeButtons();
  updateUi();
  audio.update(app.flight);
}

function finishLiveFlight() {
  if (app.completed) return;
  app.completed = true;
  const slot = recordCompletedFlight(app.flight);
  showResult(app.flight);
  updateUi();
  audio.update(app.flight);
  if (slot === "B" && !isSameInitial(app.records.A, app.records.B)) {
    ui.routeDetail.textContent += " · 两次初值不同，A/B 对比不可用";
  }
}

function replayFlight(slot, { autoplay = true } = {}) {
  const flight = app.records[slot];
  if (!flight) return;
  app.mode = "replay";
  app.replaySlot = slot;
  app.playback.time = 0;
  app.playback.duration = Math.max(0.1, flight.time);
  app.playback.playing = autoplay;
  app.playback.rate = 1;
  hideResult();
  setModeButtons();
  updateUi();
}

function overlayFlights() {
  if (app.mode === "replay") {
    const flight = app.records[app.replaySlot];
    if (!flight) return [];
    return [{
      flight,
      time: app.playback.time,
      color: app.replaySlot === "A" ? "#48c8d0" : "#ff7548",
      label: app.replaySlot,
    }];
  }
  if (app.mode === "compare" && app.records.A && app.records.B) {
    return [
      {
        flight: app.records.A,
        time: app.playback.time,
        color: "#48c8d0",
        label: "A",
      },
      {
        flight: app.records.B,
        time: app.playback.time,
        color: "#ff7548",
        label: "B",
        dashed: true,
      },
    ];
  }
  return [];
}

function enterCompare() {
  if (!isSameInitial(app.records.A, app.records.B)) {
    generateComparison();
    return;
  }
  app.mode = "compare";
  app.playback.time = 0;
  app.playback.duration = Math.max(app.records.A.time, app.records.B.time);
  app.playback.playing = true;
  app.playback.rate = 1.18;
  hideResult();
  setModeButtons();
  updateUi();
}

function generateComparison() {
  const base = settingsFrom({
    cg: app.settings.cg,
    pitch: app.settings.pitch,
  });
  const flightA = runSimulation({ ...base, span: 3 }, { auto: true });
  const flightB = runSimulation({ ...base, span: 3.8 }, { auto: true });
  flightA.recordLabel = "A";
  flightB.recordLabel = "B";
  app.records.A = flightA;
  app.records.B = flightB;
  app.replaySlot = "A";
  app.lastRecordSlot = "A";
  app.playback.time = 0;
  app.playback.duration = Math.max(flightA.time, flightB.time);
  app.playback.playing = true;
  app.playback.rate = 1.18;
  app.mode = "compare";
  app.autoPilot = false;
  hideResult();
  setModeButtons();
  updateUi();
}

function setMode(mode) {
  if (mode === "compare") {
    if (app.records.A && app.records.B && isSameInitial(app.records.A, app.records.B)) {
      enterCompare();
    } else {
      generateComparison();
    }
    return;
  }
  if (mode === "replay") {
    replayFlight(app.replaySlot);
    return;
  }
  app.mode = "live";
  app.playback.playing = false;
  setModeButtons();
  updateUi();
}

function adjustPitch(delta) {
  if (app.mode !== "live" || app.flight.status !== "flying") return;
  app.settings.pitch = clamp(Math.round((app.settings.pitch + delta) * 2) / 2, -32, 15);
  setPitchCommand(app.flight, app.settings.pitch);
  syncControls();
}

function togglePlayback() {
  if (app.mode === "live") return;
  if (app.playback.time >= app.playback.duration - 0.02) {
    app.playback.time = 0;
  }
  app.playback.playing = !app.playback.playing;
  updateUi();
}

async function toggleAudio() {
  if (!audio.enabled) {
    try {
      await audio.enable();
      ui.audio.setAttribute("aria-pressed", "true");
      ui.audioLabel.textContent = "环境声 开";
      audio.update(currentFrameFlight());
    } catch (error) {
      ui.audioLabel.textContent = "音频不可用";
      console.warn("Web Audio unavailable", error);
    }
  } else {
    await audio.disable();
    ui.audio.setAttribute("aria-pressed", "false");
    ui.audioLabel.textContent = "环境声 关";
  }
}

function handleControlInput(type, event) {
  const value = Number(event.target.value);
  if (type === "span") app.settings.span = value;
  if (type === "cg") app.settings.cg = value;
  if (type === "pitch") {
    app.settings.pitch = value;
    if (app.mode === "live" && app.flight.status === "flying") {
      setPitchCommand(app.flight, value);
    }
  }
  syncControls();

  if (type === "pitch") {
    if (app.mode === "live" && app.flight.status === "flying") {
      updateUi();
      return;
    }
    if (app.flight.status !== "ready") resetToLiveFlight();
    else {
      app.flight = createFlight(settingsFrom(app.settings));
      updateUi();
    }
    return;
  }

  resetToLiveFlight();
}

function bindEvents() {
  ui.span.addEventListener("input", (event) => handleControlInput("span", event));
  ui.cg.addEventListener("input", (event) => handleControlInput("cg", event));
  ui.pitch.addEventListener("input", (event) => handleControlInput("pitch", event));

  ui.launch.addEventListener("click", () => launchFlight());
  ui.demo.addEventListener("click", () => {
    app.settings = settingsFrom({ span: 3.4, cg: -2, pitch: -17.5 });
    syncControls();
    launchFlight({ auto: true, rate: 2.35 });
  });
  ui.compareSetup.addEventListener("click", generateComparison);
  ui.reset.addEventListener("click", resetToLiveFlight);
  ui.audio.addEventListener("click", toggleAudio);

  ui.modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });

  ui.recordA.addEventListener("click", () => replayFlight("A"));
  ui.recordB.addEventListener("click", () => replayFlight("B"));
  ui.compareButton.addEventListener("click", enterCompare);
  ui.playButton.addEventListener("click", togglePlayback);
  ui.timeline.addEventListener("input", () => {
    if (app.mode === "live") return;
    app.playback.time = (Number(ui.timeline.value) / 1000) * app.playback.duration;
    app.playback.playing = false;
    updateUi();
  });

  ui.resultAction.addEventListener("click", () => {
    const slot = app.lastRecordSlot ?? app.replaySlot;
    replayFlight(slot);
  });

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      if (app.mode !== "live" || app.flight.status !== "flying") return;
      event.preventDefault();
      adjustPitch(event.key === "ArrowUp" ? 1 : -1);
    }
    if (event.key === " ") {
      if (app.mode === "live") return;
      event.preventDefault();
      togglePlayback();
    }
  });

  const resizeObserver = new ResizeObserver(() => renderer.resize());
  resizeObserver.observe(ui.canvasShell);
}

function animate(now) {
  const dt = clamp((now - app.lastFrame) / 1000, 0, 0.05);
  app.lastFrame = now;

  if (app.mode === "live" && app.flight.status === "flying") {
    if (app.autoPilot) setPitchCommand(app.flight, autopilotPitch(app.flight));
    app.accumulator += dt * app.simRate;
    const step = 1 / 90;
    let iterations = 0;
    while (app.accumulator >= step && iterations < 24) {
      stepFlight(app.flight, step);
      app.accumulator -= step;
      iterations += 1;
      if (app.flight.status !== "flying") break;
    }
    if (app.flight.status !== "flying") finishLiveFlight();
  } else if (app.mode !== "live" && app.playback.playing) {
    app.playback.time += dt * app.playback.rate;
    if (app.playback.time >= app.playback.duration) {
      app.playback.time = app.playback.duration;
      app.playback.playing = false;
    }
  }

  const state = displayState();
  updateStatusUi(state);
  updateTelemetry(state.sample);
  updateRoute(state);
  updateCoach(state);
  updateConsole();

  const overlays = overlayFlights();
  const liveFlight = app.mode === "live" ? app.flight : state.flight;
  renderer.draw({
    overlays,
    live: app.mode === "live" ? app.flight : null,
    markFlight: state.flight,
    markTime: app.mode === "live" ? app.flight.time : app.playback.time,
    visualTime: now / 1000,
    routeMode: app.mode,
  });

  audio.update(
    app.mode === "live"
      ? app.flight
      : state.sample && state.flight
        ? { ...state.sample, status: state.flight.status }
        : liveFlight,
  );
  requestAnimationFrame(animate);
}

syncControls();
setModeButtons();
bindEvents();
updateUi();
requestAnimationFrame(animate);
