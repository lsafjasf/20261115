import { StormAudio } from "./audio.js";
import {
  BUILDINGS,
  FIXED_STEP,
  SEEDS,
  createSimulation,
  fingerprint,
  getMapView,
  getMetrics,
  getSectionView,
  moveSandbag,
  stepSimulation,
  toggleGate,
} from "./simulation.js";
import { MapRenderer, SectionRenderer } from "./renderer.js";

const DEFAULT_SEED = "0814";
const mapCanvas = document.querySelector("#map-canvas");
const sectionCanvas = document.querySelector("#section-canvas");
const mapFrame = mapCanvas.closest(".canvas-frame");
const mapRenderer = new MapRenderer(mapCanvas);
const sectionRenderer = new SectionRenderer(sectionCanvas);
const audio = new StormAudio();

let sim = createSimulation(DEFAULT_SEED);
let paused = false;
let activeTool = "sandbag";
let selectedId = null;
let draggingBagId = null;
let dragCell = null;
let dragValid = false;
let hoverBagId = null;
let hoverGateId = null;
let resultShown = false;
let lastFrame = performance.now();
let accumulator = 0;
let lastUiUpdate = 0;
let toastTimer = 0;
let hintTimer = 0;
let verifyPromise = null;

const seedSwitcher = document.querySelector("#seed-switcher");
for (const seed of SEEDS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "seed-button";
  button.dataset.seed = seed.id;
  button.title = `${seed.name} · ${seed.descriptor}`;
  button.textContent = seed.id;
  seedSwitcher.append(button);
}

function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function setActiveSeed() {
  for (const button of seedSwitcher.querySelectorAll("button")) {
    const active = button.dataset.seed === sim.seedId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function showToast(message, duration = 2400) {
  const toast = document.querySelector("#toast");
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), duration);
}

function updateDragHint() {
  const hint = document.querySelector("#drag-hint");
  if (!hintTimer) hintTimer = window.setTimeout(() => hint.classList.remove("visible"), 7000);
  if (activeTool === "sandbag") hint.classList.add("visible");
  else hint.classList.remove("visible");
}

function requestNewSimulation(seedId, message) {
  sim = createSimulation(seedId);
  paused = false;
  accumulator = 0;
  selectedId = null;
  draggingBagId = null;
  dragCell = null;
  hoverBagId = null;
  hoverGateId = null;
  resultShown = false;
  document.querySelector("#result-overlay").classList.remove("visible");
  document.querySelector("#result-overlay").setAttribute("aria-hidden", "true");
  document.querySelector("#pause-button").classList.remove("paused");
  document.querySelector("#pause-label").textContent = "PAUSE";
  setActiveSeed();
  updateUI(true);
  if (message) showToast(message);
}

function togglePause() {
  paused = !paused;
  const button = document.querySelector("#pause-button");
  button.classList.toggle("paused", paused);
  document.querySelector("#pause-label").textContent = paused ? "RESUME" : "PAUSE";
  showToast(paused ? "SIMULATION PAUSED · Inspection and placement remain active" : "SIMULATION RESUMED");
  audio.tone(paused ? 280 : 420, 0.1, 0.04);
}

function selectSeed(seedId) {
  const seed = SEEDS.find((item) => item.id === seedId);
  if (!seed) return;
  requestNewSimulation(seedId, `FIXED SCENARIO ${seed.id} LOADED · ${seed.name}`);
  audio.tone(330, 0.13, 0.04);
}

function toggleSelectedGate(gateId, source) {
  const result = toggleGate(sim, gateId);
  if (!result.ok) {
    showToast(result.reason);
    return;
  }
  const gate = sim.gates.find((item) => item.id === gateId);
  audio.gate(result.open);
  showToast(`${gate.name} ${result.open ? "OPENED" : "CLOSED"} · ${source}`);
  updateUI(true);
  hideDragHint();
}

function hideDragHint() {
  document.querySelector("#drag-hint").classList.remove("visible");
}

setActiveSeed();

function updateUI(force = false) {
  const now = performance.now();
  if (!force && now - lastUiUpdate < 180) return;
  lastUiUpdate = now;
  const metrics = getMetrics(sim);
  const mapView = getMapView(sim);
  const sectionView = getSectionView(sim);
  const residentialRatio = metrics.safeCount / metrics.residentialCount;

  document.querySelector("#event-name").textContent = sim.config.name;
  document.querySelector("#event-clock").textContent = `T+${formatClock(sim.time)}`;
  document.querySelector("#event-progress").style.width = `${Math.min(100, (sim.time / sim.duration) * 100)}%`;
  document.querySelector("#map-readout").textContent = `RIVER ${sim.riverStage.toFixed(2)}M`;
  document.querySelector("#section-readout").textContent =
    `PEAK ${Math.max(...sectionView.columns.map((column) => column.depth)).toFixed(2)}M`;
  document.querySelector("#rain-value").textContent = `${Math.round(sim.rainfall * 91)}`;

  document.querySelector("#safe-count").textContent = metrics.safeCount;
  document.querySelector("#safe-percent").textContent = `${Math.round(residentialRatio * 100)}%`;
  document.querySelector("#residential-meter").style.width = `${residentialRatio * 100}%`;
  const residentialState = document.querySelector("#residential-state");
  residentialState.textContent = metrics.residentialSafe ? "ON TARGET" : metrics.safeCount >= 7 ? "AT RISK" : "DRAIN NEEDED";
  residentialState.classList.toggle("safe", metrics.residentialSafe);
  residentialState.classList.toggle("danger", !metrics.residentialSafe);
  document.querySelector("#residential-objective").classList.toggle("warning", !metrics.residentialSafe);

  const criticals = [
    {
      id: "hospital",
      state: metrics.hospital,
      bar: "#hospital-bar",
      level: "#hospital-level",
      label: "#hospital-state",
      card: "#hospital-card",
    },
    {
      id: "substation",
      state: metrics.substation,
      bar: "#substation-bar",
      level: "#substation-level",
      label: "#substation-state",
      card: "#substation-card",
    },
  ];
  for (const critical of criticals) {
    document.querySelector(critical.level).textContent = critical.state.level.toFixed(2);
    document.querySelector(critical.bar).style.width = `${Math.min(100, (critical.state.level / critical.state.threshold) * 100)}%`;
    document.querySelector(critical.label).textContent = critical.state.safe ? "SAFE" : "ALERT";
    document.querySelector(critical.card).classList.toggle("warning", !critical.state.safe);
  }

  const synced = mapView.sharedDigest === sectionView.sharedDigest;
  document.querySelector("#integrity-hash").textContent = mapView.sharedDigest.slice(0, 4).toUpperCase();
  document.querySelector("#sync-value").textContent = synced ? "100%" : "ERR";
  document.querySelector("#integrity-row").classList.toggle("out-of-sync", !synced);
  document.querySelector("#integrity-row b").textContent = synced ? "SYNCED" : "MISMATCH";

  if (sim.ended && !resultShown) showResult(metrics);
}

function showResult(metrics) {
  resultShown = true;
  const overlay = document.querySelector("#result-overlay");
  const success = metrics.success;
  document.querySelector("#result-kicker").textContent = success ? "FLOOD EVENT CONTAINED" : "FLOOD EVENT COMPLETE";
  document.querySelector("#result-title").textContent = success ? "BLOCKS HELD" : "DEFENSE BREACHED";
  document.querySelector("#result-copy").textContent = success
    ? `Flood event ${sim.seedId} is complete. ${Math.round(metrics.safeRatio * 100)}% of residential blocks stayed safe, and both lifeline assets remained below their intake thresholds.`
    : `Flood event ${sim.seedId} is complete. ${metrics.residentialCount - metrics.safeCount} residential blocks exceeded 0.50m, or a lifeline asset entered alarm level.`;
  document.querySelector("#result-stats").innerHTML = `
    <div class="result-stat"><span>SAFE BLOCKS</span><b>${metrics.safeCount} / ${metrics.residentialCount}</b></div>
    <div class="result-stat"><span>HOSPITAL LEVEL</span><b>${metrics.hospital.level.toFixed(2)} m</b></div>
    <div class="result-stat"><span>SUBSTATION LEVEL</span><b>${metrics.substation.level.toFixed(2)} m</b></div>
  `;
  overlay.classList.add("visible");
  overlay.setAttribute("aria-hidden", "false");
  audio.outcome(success);
}

function verifyRun(seedId) {
  const prepare = (model) => {
    const gatesToOpen = ["g2", "g3"];
    for (const id of gatesToOpen) {
      const gate = model.gates.find((item) => item.id === id);
      if (!gate.open) toggleGate(model, id);
    }
    moveSandbag(model, "b1", 9, 0);
    moveSandbag(model, "b2", 10, 0);
    moveSandbag(model, "b3", 11, 0);
    moveSandbag(model, "b4", 12, 0);
    moveSandbag(model, "b5", 13, 0);
  };

  const first = createSimulation(seedId);
  const second = createSimulation(seedId);
  prepare(first);
  prepare(second);
  const steps = Math.round((first.duration - first.time) / FIXED_STEP);
  for (let i = 0; i < steps; i += 1) {
    stepSimulation(first, FIXED_STEP);
    stepSimulation(second, FIXED_STEP);
  }
  const firstDigest = fingerprint(first);
  const secondDigest = fingerprint(second);
  const mapDigest = getMapView(first).sharedDigest;
  const sectionDigest = getSectionView(first).sharedDigest;
  return {
    seed: seedId,
    deterministic: firstDigest === secondDigest,
    viewsConsistent: mapDigest === sectionDigest,
    digest: firstDigest,
  };
}

function verifyAllSeeds() {
  if (verifyPromise) return verifyPromise;
  verifyPromise = Promise.resolve().then(() => {
    const results = SEEDS.map((seed) => verifyRun(seed.id));
    const allOk = results.every((result) => result.deterministic && result.viewsConsistent);
    const row = document.querySelector("#integrity-row");
    row.title = results
      .map((result) => `${result.seed}: ${result.deterministic && result.viewsConsistent ? "PASS" : "FAIL"}`)
      .join(" · ");
    row.classList.toggle("verification-failed", !allOk);
    console.info("[STORM//LINK] fixed-seed verification", results);
    return { allOk, results };
  });
  return verifyPromise;
}

function runMapAction(actionResult, successMessage) {
  if (!actionResult.ok) {
    showToast(actionResult.reason);
    return false;
  }
  if (successMessage) showToast(successMessage);
  updateUI(true);
  hideDragHint();
  return true;
}

let audioStarted = false;
async function wakeAudio() {
  if (audioStarted) return;
  audioStarted = true;
  await audio.start();
}

function updateMapTooltip(event, hit, drag) {
  const tooltip = document.querySelector("#map-tooltip");
  if (!hit) {
    tooltip.classList.remove("visible");
    return;
  }
  let text = "";
  if (drag && drag.cell) {
    text = drag.valid ? "RELEASE TO PLACE SANDBAG" : "BLOCKED CELL";
  } else if (hit.type === "gate") {
    text = `${hit.gate.name.toUpperCase()} · ${hit.gate.open ? "DRAIN OPEN" : "DRAIN SHUT"} · CLICK TO TOGGLE`;
  } else if (hit.type === "bag") {
    text = `${hit.bag.id.toUpperCase()} SANDBAG · DRAG TO REDEPLOY`;
  } else if (hit.type === "building") {
    const state = getMetrics(sim).states.find((item) => item.id === hit.building.id);
    text = `${hit.building.name} · ${state.level.toFixed(2)}M`;
  } else if (hit.type === "cell") {
    text = `FLOOD ${sim.water[hit.r][hit.c].toFixed(2)}M · GROUND ${sim.terrain[hit.r][hit.c].toFixed(2)}M`;
  }
  const frameRect = mapFrame.getBoundingClientRect();
  tooltip.textContent = text;
  tooltip.style.left = `${Math.min(mapFrame.clientWidth - 135, event.clientX - frameRect.left)}px`;
  tooltip.style.top = `${Math.min(mapFrame.clientHeight - 35, event.clientY - frameRect.top)}px`;
  tooltip.classList.toggle("visible", Boolean(text));
}

function validateDragCell(cell) {
  if (!cell) return false;
  if (sim.sandbags.some((bag) => bag.id !== draggingBagId && bag.c === cell.c && bag.r === cell.r)) return false;
  if (sim.gates.some((gate) => gate.c === cell.c && gate.r === cell.r)) return false;
  return true;
}

mapCanvas.addEventListener("pointerdown", (event) => {
  wakeAudio();
  const hit = mapRenderer.hitTest(event.clientX, event.clientY, sim);
  if (!hit) return;

  if (hit.type === "gate") {
    toggleSelectedGate(hit.gate.id, "MAP");
    return;
  }
  if (hit.type === "building") {
    selectedId = hit.building.id;
    updateUI(true);
    showToast(`${hit.building.name.toUpperCase()} LOCATED · SECTION LINKED`);
    return;
  }
  if (hit.type === "bag") {
    if (activeTool !== "sandbag") {
      showToast("GATE TOOL ACTIVE · SWITCH TO SANDBAG TO DRAG");
      return;
    }
    draggingBagId = hit.bag.id;
    dragCell = null;
    dragValid = false;
    hoverBagId = hit.bag.id;
    mapFrame.classList.add("dragging");
    mapCanvas.setPointerCapture(event.pointerId);
    hideDragHint();
    return;
  }
  if (hit.type === "cell" && activeTool === "sandbag") {
    showToast("HOLD A SANDBAG AND DRAG IT ONTO A TARGET ROAD");
  }
});

mapCanvas.addEventListener("pointermove", (event) => {
  const hit = mapRenderer.hitTest(event.clientX, event.clientY, sim);
  hoverBagId = hit?.type === "bag" ? hit.bag.id : null;
  hoverGateId = hit?.type === "gate" ? hit.gate.id : null;

  if (draggingBagId) {
    dragCell = mapRenderer.cellFromClient(event.clientX, event.clientY);
    dragValid = validateDragCell(dragCell);
    updateMapTooltip(event, hit, { cell: dragCell, valid: dragValid });
    return;
  }
  updateMapTooltip(event, hit, null);
});

function finishBagDrag() {
  if (!draggingBagId) return;
  if (dragCell && dragValid) {
    const result = moveSandbag(sim, draggingBagId, dragCell.c, dragCell.r);
    if (result.ok) {
      audio.bag();
      selectedId = null;
    }
    runMapAction(result, "");
  }
  draggingBagId = null;
  dragCell = null;
  dragValid = false;
  mapFrame.classList.remove("dragging");
  document.querySelector("#map-tooltip").classList.remove("visible");
  updateUI(true);
}

mapCanvas.addEventListener("pointerup", finishBagDrag);
mapCanvas.addEventListener("pointercancel", finishBagDrag);
mapCanvas.addEventListener("pointerleave", () => {
  if (!draggingBagId) {
    hoverBagId = null;
    hoverGateId = null;
    document.querySelector("#map-tooltip").classList.remove("visible");
  }
});

sectionCanvas.addEventListener("pointerdown", (event) => {
  wakeAudio();
  const hit = sectionRenderer.hitTest(event.clientX, event.clientY);
  if (!hit) return;
  if (hit.type === "gate") {
    toggleSelectedGate(hit.id, "SECTION");
    return;
  }
  if (hit.type === "building") {
    selectedId = hit.id;
    const building = BUILDINGS.find((item) => item.id === hit.id);
    const state = getMetrics(sim).states.find((item) => item.id === hit.id);
    showToast(`${building.name.toUpperCase()} · ${state.level.toFixed(2)}m · BASEMENT ${state.basement.toFixed(2)}m`);
    updateUI(true);
  }
});

sectionCanvas.addEventListener("pointermove", (event) => {
  const hit = sectionRenderer.hitTest(event.clientX, event.clientY);
  sectionCanvas.style.cursor = hit ? "pointer" : "crosshair";
});

function setTool(tool) {
  activeTool = tool;
  document.querySelector("#sandbag-tool").classList.toggle("active", tool === "sandbag");
  document.querySelector("#gate-tool").classList.toggle("active", tool === "gate");
  mapCanvas.style.cursor = tool === "sandbag" ? "grab" : "default";
  updateDragHint();
  showToast(tool === "sandbag" ? "SANDBAG TOOL · Drag existing bags to redeploy" : "GATE TOOL · Click a gate in either view");
}

document.querySelector("#sandbag-tool").addEventListener("click", () => setTool("sandbag"));
document.querySelector("#gate-tool").addEventListener("click", () => setTool("gate"));
document.querySelector("#pause-button").addEventListener("click", togglePause);
document.querySelector("#restart-button").addEventListener("click", () => {
  requestNewSimulation(sim.seedId, `SCENARIO ${sim.seedId} RESTARTED`);
  audio.tone(360, 0.12, 0.04);
});
document.querySelector("#audio-button").addEventListener("click", async () => {
  if (!audioStarted) {
    const ready = await wakeAudio().catch(() => false);
    showToast(ready ? "RAIN AND WATER AUDIO ENABLED" : "AUDIO UNAVAILABLE IN THIS BROWSER");
    return;
  }
  const enabled = await audio.toggle();
  const button = document.querySelector("#audio-button");
  button.classList.toggle("audio-muted", !enabled);
  button.setAttribute("aria-pressed", String(enabled));
  document.querySelector("#audio-label").textContent = enabled ? "SOUND ON" : "SOUND OFF";
  showToast(enabled ? "RAIN AND WATER AUDIO ENABLED" : "AUDIO MUTED");
});

seedSwitcher.addEventListener("click", (event) => {
  const button = event.target.closest(".seed-button");
  if (!button) return;
  wakeAudio();
  selectSeed(button.dataset.seed);
});

document.querySelector("#result-restart").addEventListener("click", () => {
  requestNewSimulation(sim.seedId, `REPLAYING SCENARIO ${sim.seedId}`);
});
document.querySelector("#result-close").addEventListener("click", () => {
  document.querySelector("#result-overlay").classList.remove("visible");
  document.querySelector("#result-overlay").setAttribute("aria-hidden", "true");
});
document.querySelector("#integrity-row").addEventListener("click", async () => {
  const result = await verifyAllSeeds();
  showToast(
    result.allOk
      ? "3/3 SEEDS REPRODUCED · MAP AND SECTION STATE MATCH"
      : "VERIFICATION FAILED · CHECK SHARED STATE",
    3600,
  );
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLButtonElement && event.code === "Space") return;
  if (event.code === "Space") {
    event.preventDefault();
    togglePause();
  } else if (event.key.toLowerCase() === "r") {
    requestNewSimulation(sim.seedId, `SCENARIO ${sim.seedId} RESTARTED`);
  } else if (event.key.toLowerCase() === "m") {
    document.querySelector("#audio-button").click();
  }
});

let resizeObserver = null;
if ("ResizeObserver" in window) {
  resizeObserver = new ResizeObserver(() => {
    mapRenderer.resize();
    sectionRenderer.resize();
  });
  resizeObserver.observe(mapCanvas.parentElement);
  resizeObserver.observe(sectionCanvas.parentElement);
} else {
  window.addEventListener("resize", () => {
    mapRenderer.resize();
    sectionRenderer.resize();
  });
}

function frame(now) {
  const elapsed = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (!paused && !sim.ended) {
    accumulator += elapsed;
    let guard = 0;
    while (accumulator >= FIXED_STEP && guard < 12) {
      stepSimulation(sim, FIXED_STEP);
      accumulator -= FIXED_STEP;
      guard += 1;
    }
  } else {
    accumulator = 0;
  }

  const visualTime = now / 1000;
  mapRenderer.draw(sim, {
    time: visualTime,
    selectedId,
    draggingBagId,
    dragCell,
    dragValid,
    hoverBagId,
    hoverGateId,
  });
  const sectionView = getSectionView(sim);
  sectionRenderer.draw(sim, {
    time: visualTime,
    view: sectionView,
    selectedId,
  });

  const metrics = getMetrics(sim);
  const pressure = Math.max(metrics.hospital.level, metrics.substation.level, ...metrics.residential.map((state) => state.level)) / 0.8;
  audio.update(sim.rainfall, pressure, paused);
  updateUI();
  window.requestAnimationFrame(frame);
}

window.__stormlink = {
  get seed() {
    return sim.seedId;
  },
  get paused() {
    return paused;
  },
  getState() {
    const metrics = getMetrics(sim);
    return {
      seed: sim.seedId,
      time: sim.time,
      ended: sim.ended,
      paused,
      rainfall: sim.rainfall,
      riverStage: sim.riverStage,
      gates: sim.gates.map((gate) => ({ ...gate })),
      sandbags: sim.sandbags.map((bag) => ({ ...bag })),
      metrics,
      digest: fingerprint(sim),
    };
  },
  getViews() {
    return { map: getMapView(sim), section: getSectionView(sim) };
  },
  step(seconds = FIXED_STEP) {
    const steps = Math.max(1, Math.round(seconds / FIXED_STEP));
    for (let i = 0; i < steps; i += 1) stepSimulation(sim, FIXED_STEP);
    updateUI(true);
    return fingerprint(sim);
  },
  setPaused(value) {
    if (Boolean(value) !== paused) togglePause();
    return paused;
  },
  moveSandbag(bagId, c, r) {
    const result = moveSandbag(sim, bagId, c, r);
    updateUI(true);
    return result;
  },
  toggleGate(gateId) {
    const result = toggleGate(sim, gateId);
    updateUI(true);
    return result;
  },
  restart(seedId = sim.seedId) {
    requestNewSimulation(seedId);
    return sim.seedId;
  },
  verifySeeds: verifyAllSeeds,
};

updateUI(true);
updateDragHint();
window.requestAnimationFrame((now) => {
  lastFrame = now;
  frame(now);
});
window.setTimeout(() => {
  verifyAllSeeds().catch((error) => console.warn("Fixed-seed verification failed", error));
}, 500);
