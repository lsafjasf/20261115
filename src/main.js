import { CONFIG, SaltRun, TRACK } from "./sim.js";
import { SceneRenderer } from "./scene.js";
import { GameAudio } from "./audio.js";

const run = new SaltRun();
const canvas = document.querySelector("#gameCanvas");
const renderer = new SceneRenderer(canvas);
const audio = new GameAudio();

const elements = {
  routeProgress: document.querySelector("#routeProgress"),
  materialHud: document.querySelector("#materialHud"),
  pollutionHud: document.querySelector("#pollutionHud"),
  pollutionChip: document.querySelector(".hud-chip--risk"),
  curveAlert: document.querySelector("#curveAlert"),
  startOverlay: document.querySelector("#startOverlay"),
  resultOverlay: document.querySelector("#resultOverlay"),
  startButton: document.querySelector("#startButton"),
  retryButton: document.querySelector("#retryButton"),
  resetButton: document.querySelector("#resetButton"),
  soundButton: document.querySelector("#soundButton"),
  soundIcon: document.querySelector("#soundIcon"),
  sectionList: document.querySelector("#sectionList"),
  statusLine: document.querySelector("#statusLine"),
  widthControl: document.querySelector("#widthControl"),
  speedControl: document.querySelector("#speedControl"),
  outletControl: document.querySelector("#outletControl"),
  widthValue: document.querySelector("#widthValue"),
  speedValue: document.querySelector("#speedValue"),
  outletValue: document.querySelector("#outletValue"),
  resultCard: document.querySelector(".result-card"),
  resultKicker: document.querySelector("#resultKicker"),
  resultSeal: document.querySelector("#resultSeal"),
  resultTitle: document.querySelector("#resultTitle"),
  resultSummary: document.querySelector("#resultSummary"),
  resultStats: document.querySelector("#resultStats"),
};

const ui = {
  status: "ready",
  lastFrame: performance.now(),
  accumulator: 0,
  lastUiUpdate: 0,
  finishShown: false,
  sectionCards: [],
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function currentControls() {
  return {
    width: Number(elements.widthControl.value),
    speed: Number(elements.speedControl.value),
    outlet: Number(elements.outletControl.value) / 100,
  };
}

function buildSectionCards() {
  elements.sectionList.replaceChildren();
  ui.sectionCards = TRACK.sections.map((section) => {
    const card = document.createElement("article");
    card.className = "section-card";
    card.innerHTML = `
      <span class="section-index">${section.code.replace("S-", "")}</span>
      <span class="section-copy">
        <strong>${section.name}</strong>
        <small>${section.note} · ${Math.round(section.lengthM)} m</small>
      </span>
      <span class="section-score">0%</span>
    `;
    elements.sectionList.append(card);
    return {
      card,
      score: card.querySelector(".section-score"),
    };
  });
}

function syncControlLabels() {
  const controls = currentControls();
  elements.widthValue.value = `${controls.width.toFixed(1)} m`;
  elements.speedValue.value = `${controls.speed.toFixed(0)} km/h`;
  elements.outletValue.value = `${Math.round(controls.outlet * 100)}%`;
}

function setControls(controls) {
  elements.widthControl.value = String(
    clamp(controls.width, CONFIG.width.min, CONFIG.width.max),
  );
  elements.speedControl.value = String(
    clamp(controls.speed, CONFIG.speed.min, CONFIG.speed.max),
  );
  elements.outletControl.value = String(
    clamp(controls.outlet * 100, CONFIG.outlet.min * 100, CONFIG.outlet.max * 100),
  );
  syncControlLabels();
}

function statusText(stats, curveWarning) {
  if (run.status === "ready") return "等待发车指令";
  if (run.status === "finished") {
    return stats.success ? "三段坡道完成，等待交班" : "行程结束，覆盖未达标";
  }
  if (stats.remaining < 0.2) return "料仓余量不足，减少出口或提高车速";
  if (curveWarning) return "弯道离心偏析，减速或加宽撒布面";
  const active = stats.sections[run.activeSection];
  if (active && active.coverage < CONFIG.coveragePass) return "当前坡道出现漏撒，补足撒布量";
  return "撒布正常，保持横向覆盖";
}

function updateInterface(force = false, curveWarning = false) {
  const now = performance.now();
  if (!force && now - ui.lastUiUpdate < 90) return;
  ui.lastUiUpdate = now;
  const stats = run.getStats();
  elements.routeProgress.textContent = `${Math.round(stats.progress * 100)}%`;
  elements.materialHud.textContent = `${Math.round(stats.remaining * 100)}%`;
  elements.pollutionHud.textContent = `${Math.round(stats.pollution)}%`;
  elements.pollutionChip.classList.toggle("is-warning", stats.pollution >= 55);

  stats.sections.forEach((section, index) => {
    const card = ui.sectionCards[index];
    if (!card) return;
    card.score.textContent = `${Math.round(section.coverage * 100)}%`;
    card.card.classList.toggle("is-pass", section.pass);
    card.card.classList.toggle(
      "is-fail",
      run.status === "finished" && !section.pass,
    );
    card.card.classList.toggle(
      "is-active",
      run.status === "running" && run.activeSection === index,
    );
    card.card.style.setProperty("--coverage", `${section.coverage * 100}%`);
  });

  elements.curveAlert.classList.toggle(
    "is-visible",
    curveWarning && run.status === "running",
  );
  elements.statusLine.classList.toggle("is-running", run.status === "running");
  elements.statusLine.classList.toggle(
    "is-warning",
    curveWarning || (run.status === "running" && stats.pollution >= 80),
  );
  elements.statusLine.innerHTML = `<span></span>${statusText(stats, curveWarning)}`;

  if (run.status === "finished" && !ui.finishShown) {
    ui.finishShown = true;
    window.setTimeout(() => showResult(stats), 720);
  }
}

function showResult(stats) {
  const failedSections = stats.sections.filter((section) => !section.pass);
  const success = stats.success;
  elements.resultOverlay.hidden = false;
  elements.resultCard.classList.toggle("is-failure", !success);
  elements.resultKicker.textContent = success ? "ROUTE CLEARED · 05:42" : "COVERAGE FAILURE";
  elements.resultSeal.textContent = success ? "✓" : "×";
  elements.resultTitle.textContent = success ? "三段坡道已封闭" : "仍有路面会重新结冰";

  const reasons = [];
  if (failedSections.length) {
    reasons.push(`${failedSections.map((section) => section.name).join("、")}覆盖不足`);
  }
  if (!stats.enoughMaterial) reasons.push("料仓余料低于 12%");
  if (success) {
    reasons.push(
      stats.pollution >= 55
        ? "路面达标，但溪流污染偏高，交班评级受到影响"
        : "覆盖与余料均达标，寒潮前完成交班",
    );
  }
  elements.resultSummary.textContent = reasons.join("；") + "。";
  elements.resultStats.innerHTML = [
    ...stats.sections.map((section) => `
      <div class="result-stat">
        <span>${section.code} ${section.name}</span>
        <strong>${Math.round(section.coverage * 100)}%</strong>
      </div>
    `),
    `<div class="result-stat"><span>料仓余量</span><strong>${Math.round(stats.remaining * 100)}%</strong></div>`,
    `<div class="result-stat"><span>溪流污染</span><strong>${Math.round(stats.pollution)}%</strong></div>`,
  ].join("");
  audio.setRunning(false);
  audio.update(currentControls(), false);
}

async function startGame() {
  if (run.status !== "ready") return;
  run.setControls(currentControls());
  run.start();
  ui.status = "running";
  ui.finishShown = false;
  elements.curveAlert.classList.remove("is-visible");
  elements.startOverlay.classList.add("is-leaving");
  await audio.unlock();
  audio.setRunning(true);
  window.setTimeout(() => {
    elements.startOverlay.hidden = true;
    elements.startOverlay.classList.remove("is-leaving");
  }, 420);
  updateInterface(true);
}

function resetGame() {
  run.reset();
  setControls({
    width: CONFIG.width.default,
    speed: CONFIG.speed.default,
    outlet: CONFIG.outlet.default,
  });
  ui.status = "ready";
  ui.accumulator = 0;
  ui.finishShown = false;
  elements.startOverlay.hidden = false;
  elements.startOverlay.classList.remove("is-leaving");
  elements.resultOverlay.hidden = true;
  elements.resultCard.classList.remove("is-failure");
  audio.setRunning(false);
  updateInterface(true);
}

function toggleSound() {
  const enabled = !audio.enabled;
  audio.setEnabled(enabled);
  elements.soundButton.setAttribute("aria-pressed", String(enabled));
  elements.soundIcon.textContent = enabled ? "◖" : "◌";
  if (enabled) audio.unlock();
}

function adjustControl(control, amount) {
  const input = elements[control];
  const step = Number(input.step) || 1;
  input.value = String(
    clamp(Number(input.value) + amount * step, Number(input.min), Number(input.max)),
  );
  syncControlLabels();
}

function loop(now) {
  const delta = Math.min(0.08, Math.max(0, (now - ui.lastFrame) / 1000));
  ui.lastFrame = now;
  const controls = currentControls();
  let curveWarning = false;

  if (run.status === "running") {
    ui.accumulator = Math.min(ui.accumulator + delta, 0.2);
    const fixedStep = 1 / 60;
    while (ui.accumulator >= fixedStep && run.status === "running") {
      run.step(fixedStep, controls);
      ui.accumulator -= fixedStep;
    }
    const sample = run.getSampleAtProgress();
    curveWarning = Math.abs(sample.curve) > 0.14;
    audio.update(controls, run.status === "running");
  }

  renderer.render(run, {
    time: now / 1000,
    curveWarning,
    idle: run.status !== "running",
  });
  updateInterface(false, curveWarning);
  requestAnimationFrame(loop);
}

elements.startButton.addEventListener("click", startGame);
canvas.addEventListener("click", () => {
  if (run.status === "ready" && elements.startOverlay.hidden) startGame();
});
elements.retryButton.addEventListener("click", async () => {
  resetGame();
  await startGame();
});
elements.resetButton.addEventListener("click", resetGame);
elements.soundButton.addEventListener("click", toggleSound);

for (const input of [
  elements.widthControl,
  elements.speedControl,
  elements.outletControl,
]) {
  input.addEventListener("input", syncControlLabels);
}

window.addEventListener("keydown", (event) => {
  if (event.code === "Space" && run.status === "ready") {
    event.preventDefault();
    startGame();
  }
  if (event.code === "KeyR") resetGame();
  if (event.code === "KeyM") toggleSound();
  if (run.status !== "ready" && !event.repeat) {
    if (event.code === "ArrowUp") adjustControl("speedControl", 1);
    if (event.code === "ArrowDown") adjustControl("speedControl", -1);
    if (event.code === "KeyE") adjustControl("widthControl", 2);
    if (event.code === "KeyQ") adjustControl("widthControl", -2);
    if (event.code === "KeyD") adjustControl("outletControl", 2);
    if (event.code === "KeyA") adjustControl("outletControl", -2);
  }
});

window.addEventListener("resize", () => renderer.resize());
new ResizeObserver(() => renderer.resize()).observe(canvas);

buildSectionCards();
setControls({
  width: CONFIG.width.default,
  speed: CONFIG.speed.default,
  outlet: CONFIG.outlet.default,
});
updateInterface(true);
requestAnimationFrame(loop);

window.__saltRun = {
  run,
  start: startGame,
  reset: resetGame,
  stats: () => run.getStats(),
  setControls,
  advance(seconds, controls = currentControls()) {
    let remaining = seconds;
    while (remaining > 0 && run.status === "running") {
      const dt = Math.min(0.05, remaining);
      run.step(dt, controls);
      remaining -= dt;
    }
    updateInterface(true, Math.abs(run.getSampleAtProgress().curve) > 0.14);
    return run.getStats();
  },
};
