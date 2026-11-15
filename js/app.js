import { LoomCanvas } from "./loom.js";
import { DrumSynth } from "./audio.js";
import {
  cloneResults,
  createDefaultProject,
  downloadProject,
  loadPersistedState,
  normalizeProject,
  persistState,
} from "./project.js";

const elements = {
  title: document.querySelector("#projectTitle"),
  canvas: document.querySelector("#loomCanvas"),
  loomFrame: document.querySelector(".loom-frame"),
  sequenceGrid: document.querySelector("#sequenceGrid"),
  drumPads: document.querySelector("#drumPads"),
  playButton: document.querySelector("#playButton"),
  playLabel: document.querySelector("#playLabel"),
  pauseButton: document.querySelector("#pauseButton"),
  pauseLabel: document.querySelector("#pauseLabel"),
  resetButton: document.querySelector("#resetButton"),
  bpm: document.querySelector("#bpmInput"),
  beatReadout: document.querySelector("#beatReadout"),
  beatText: document.querySelector("#beatText"),
  checkCard: document.querySelector("#checkCard"),
  checkIcon: document.querySelector("#checkIcon"),
  checkTitle: document.querySelector("#checkTitle"),
  checkDetail: document.querySelector("#checkDetail"),
  saveButton: document.querySelector("#saveButton"),
  loadButton: document.querySelector("#loadButton"),
  fileInput: document.querySelector("#fileInput"),
  saveFeedback: document.querySelector("#saveFeedback"),
  toast: document.querySelector("#toast"),
};

const restored = loadPersistedState();
let project = restored?.project ?? createDefaultProject();
let status = "idle";
let activeBeat = -1;
let remainingMs = 0;
let results = new Array(16).fill(null);
let mode = "auto";
let timer = null;
let deadline = 0;
let feedbackTimer = null;
let toastTimer = null;
let padFlashTimer = null;

const synth = new DrumSynth();
const loom = new LoomCanvas(elements.canvas);
const padsById = new Map(project.pads.map((pad) => [pad.id, pad]));

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const beatDuration = () => Math.round(60000 / project.bpm);

function renderSequence() {
  elements.sequenceGrid.replaceChildren();
  project.sequence.forEach((padId, beat) => {
    const pad = padId === null ? null : padsById.get(padId);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sequence-cell";
    button.dataset.beat = String(beat);
    button.setAttribute("aria-label", `第 ${beat + 1} 拍，${pad?.label ?? "空拍"}`);
    if (padId === null) {
      button.dataset.color = "rest";
      button.classList.add("is-rest");
      button.textContent = String(beat + 1);
    } else {
      button.dataset.color = String(padId);
      button.innerHTML = `<span>${beat + 1}</span>`;
    }
    elements.sequenceGrid.append(button);
  });
  updateSequenceState();
}

function renderPads() {
  elements.drumPads.replaceChildren();
  project.pads.forEach((pad) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "drum-pad";
    button.dataset.pad = String(pad.id);
    button.style.setProperty("--pad-color", pad.color);
    button.style.setProperty("--pad-deep", shadeCss(pad.color, -0.22));
    button.setAttribute(
      "aria-label",
      `${pad.label}，快捷键 ${pad.key.toUpperCase()}`,
    );
    button.innerHTML = `
      <span class="drum-key">${pad.key}</span>
      <span class="drum-name">${pad.label}</span>
    `;
    elements.drumPads.append(button);
  });
}

function shadeCss(hex, amount) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) =>
    parseInt(value.slice(offset, offset + 2), 16),
  );
  const mixed = channels.map((channel) =>
    amount < 0
      ? Math.round(channel * (1 + amount))
      : Math.round(channel + (255 - channel) * amount),
  );
  return `rgb(${mixed.join(" ")})`;
}

function updateSequenceState() {
  const sequenceButtons = elements.sequenceGrid.querySelectorAll(
    ".sequence-cell",
  );
  sequenceButtons.forEach((button, beat) => {
    const result = results[beat];
    button.classList.toggle(
      "is-current",
      (status === "playing" || status === "paused") && activeBeat === beat,
    );
    button.classList.toggle("is-passed", Boolean(result));
    button.classList.toggle(
      "is-missed",
      result?.status === "miss" || result?.status === "error",
    );
    button.disabled = status === "playing" || status === "paused";
  });
}

function updateTransport() {
  const labels = {
    idle: ["播放/继续", "暂停", true],
    playing: ["织造中", "暂停", false],
    paused: ["继续", "继续", true],
    finished: ["再织一遍", "暂停 · 已完成", true],
  };
  const [playLabel, pauseLabel, pauseDisabled] = labels[status];
  elements.playLabel.textContent = playLabel;
  elements.pauseLabel.textContent = pauseLabel;
  elements.pauseButton.disabled = pauseDisabled;
  elements.playButton.disabled = status === "playing";
  elements.loomFrame.classList.toggle("is-playing", status === "playing");
  document.body.dataset.state = status;
  document.body.dataset.activeBeat = String(activeBeat);
  elements.beatReadout.classList.toggle(
    "is-live",
    status === "playing" || status === "paused",
  );

  if (status === "finished") {
    elements.beatText.textContent = "16 / 16 拍 · 完成";
  } else if (activeBeat >= 0) {
    elements.beatText.textContent = `第 ${activeBeat + 1} / 16 拍`;
  } else {
    elements.beatText.textContent = "第 1 / 16 拍";
  }
}

function updateProjectInputs() {
  elements.title.value = project.title;
  elements.bpm.value = String(project.bpm);
  document.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.checked = input.value === mode;
  });
  loom.setPads(project.pads);
}

function showToast(message, duration = 2200) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, duration);
}

function calculateReport() {
  const expected = project.sequence.filter((step) => step !== null).length;
  const hits = results.filter((result) => result?.status === "hit").length;
  const misses = results.filter((result) => result?.status === "miss").length;
  const errors = results.filter((result) => result?.status === "error").length;
  const rests = results.filter((result) => result?.status === "rest").length;
  const completeness =
    expected === 0 ? 100 : Math.round((hits / expected) * 100);
  return {
    passed: misses === 0 && errors === 0 && hits === expected,
    expected,
    hits,
    misses,
    errors,
    rests,
    completeness,
  };
}

function reportDetail(report) {
  return `命中 ${report.hits}/${report.expected} · 漏拍 ${report.misses} · 错拍 ${report.errors} · 休止 ${report.rests} · 完整度 ${report.completeness}%`;
}

function updateCheckCard() {
  elements.checkCard.classList.remove("is-idle", "is-success", "is-fail");
  if (status === "finished") {
    const report = calculateReport();
    project.lastReport = report;
    elements.checkCard.classList.add(report.passed ? "is-success" : "is-fail");
    elements.checkIcon.textContent = report.passed ? "✓" : "×";
    elements.checkTitle.textContent = report.passed
      ? "图案检查通过"
      : "图案检查未通过";
    elements.checkDetail.textContent = reportDetail(report);
    return report;
  }

  if (status === "playing" || status === "paused") {
    const report = calculateReport();
    elements.checkCard.classList.add("is-idle");
    elements.checkIcon.textContent = status === "paused" ? "Ⅱ" : "◌";
    elements.checkTitle.textContent =
      status === "paused" ? "织造已暂停" : "纬线正在落入经线";
    elements.checkDetail.textContent =
      `第 ${activeBeat + 1} 拍 · 已命中 ${report.hits}/${report.expected} · 点击继续可回到这一拍。`;
    return report;
  }

  elements.checkCard.classList.add("is-idle");
  elements.checkIcon.textContent = "○";
  elements.checkTitle.textContent = "图案检查 · 等待演奏";
  elements.checkDetail.textContent =
    "完成十六拍后，将自动核对命中、漏拍、错拍与休止。";
  return calculateReport();
}

function stopTimer() {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

function persistNow() {
  const frozenRemaining =
    status === "playing" ? Math.max(0, deadline - performance.now()) : remainingMs;
  persistState(project, {
    state: status,
    activeBeat,
    remainingMs: Math.round(frozenRemaining),
    results: cloneResults(results),
    mode,
  });
}

function updateAll() {
  updateProjectInputs();
  renderPads();
  renderSequence();
  updateTransport();
  updateCheckCard();
}

function resetRun({ announce = false } = {}) {
  stopTimer();
  status = "idle";
  activeBeat = -1;
  remainingMs = 0;
  results = new Array(16).fill(null);
  project.lastReport = null;
  loom.reset();
  updateSequenceState();
  updateTransport();
  updateCheckCard();
  persistNow();
  if (announce) showToast("织造已重新开始，布面已清空。");
}

function startBeat(beat) {
  stopTimer();
  activeBeat = beat;
  remainingMs = beatDuration();
  deadline = performance.now() + remainingMs;
  const target = project.sequence[beat];

  if (mode === "auto") {
    if (target === null) {
      results[beat] = { status: "rest", color: null, padId: null };
      loom.showBeat(beat, results[beat], remainingMs);
    } else {
      const pad = padsById.get(target);
      results[beat] = { status: "hit", color: pad.color, padId: target };
      loom.showBeat(beat, results[beat], remainingMs);
      synth.play(target);
    }
  } else if (target === null) {
    loom.showBeat(beat, { status: "rest", color: null, padId: null }, remainingMs);
  }

  updateSequenceState();
  updateTransport();
  updateCheckCard();
  persistNow();
  timer = window.setTimeout(finishBeat, remainingMs);
}

function finishBeat() {
  timer = null;
  if (status !== "playing" || activeBeat < 0) return;
  const beat = activeBeat;
  if (!results[beat]) {
    const target = project.sequence[beat];
    if (target === null) {
      results[beat] = { status: "rest", color: null, padId: null };
    } else {
      results[beat] = { status: "miss", color: null, padId: null };
      loom.showBeat(beat, results[beat], beatDuration());
    }
  }
  updateSequenceState();
  if (beat >= 15) {
    finishLoop();
    return;
  }
  startBeat(beat + 1);
}

function finishLoop() {
  stopTimer();
  status = "finished";
  activeBeat = -1;
  remainingMs = 0;
  loom.cancelAnimation();
  loom.setResults(results);
  const report = updateCheckCard();
  updateSequenceState();
  updateTransport();
  persistNow();
  return report;
}

async function beginRun() {
  const audioReady = await synth.unlock();
  if (!audioReady) showToast("浏览器未启用音频；画面仍可正常织造。");
  stopTimer();
  results = new Array(16).fill(null);
  project.lastReport = null;
  loom.reset();
  status = "playing";
  activeBeat = -1;
  remainingMs = 0;
  startBeat(0);
}

async function continueRun() {
  await synth.unlock();
  if (status === "finished" || status === "idle" || activeBeat < 0) {
    await beginRun();
    return;
  }
  status = "playing";
  remainingMs = remainingMs > 0 ? remainingMs : beatDuration();
  deadline = performance.now() + remainingMs;
  updateSequenceState();
  updateTransport();
  updateCheckCard();
  persistNow();
  timer = window.setTimeout(finishBeat, remainingMs);
}

async function togglePlay() {
  if (status === "playing") return;
  if (status === "paused") {
    await continueRun();
    return;
  }
  await beginRun();
}

function pauseRun() {
  if (status !== "playing") return;
  const left = Math.max(0, deadline - performance.now());
  stopTimer();
  remainingMs = left;
  if (left <= 0) {
    finishBeat();
    pauseRun();
    return;
  }
  status = "paused";
  loom.cancelAnimation();
  loom.draw();
  updateSequenceState();
  updateTransport();
  updateCheckCard();
  persistNow();
  showToast(`已暂停在第 ${activeBeat + 1} 拍，继续时从同一位置接上。`);
}

function flashPad(padId) {
  window.clearTimeout(padFlashTimer);
  elements.drumPads.querySelectorAll(".drum-pad").forEach((button) => {
    button.classList.toggle("is-hit", Number(button.dataset.pad) === padId);
  });
  padFlashTimer = window.setTimeout(() => {
    elements.drumPads
      .querySelectorAll(".drum-pad")
      .forEach((button) => button.classList.remove("is-hit"));
  }, 130);
}

async function strikePad(padId) {
  flashPad(padId);
  await synth.unlock();
  synth.play(padId);
  if (
    status !== "playing" ||
    mode !== "follow" ||
    activeBeat < 0 ||
    results[activeBeat]
  ) {
    return;
  }

  const pad = padsById.get(padId);
  const target = project.sequence[activeBeat];
  const isHit = target === padId;
  results[activeBeat] = {
    status: isHit ? "hit" : "error",
    color: pad.color,
    padId,
  };
  loom.showBeat(activeBeat, results[activeBeat], remainingMs);
  updateSequenceState();
  updateCheckCard();
  persistNow();
}

function cycleStep(beat) {
  if (status !== "idle") resetRun();
  const current = project.sequence[beat];
  project.sequence[beat] = current === null ? 0 : current >= 3 ? null : current + 1;
  renderSequence();
  updateCheckCard();
  persistNow();
}

function applyLoadedProject(nextProject, sourceLabel = "JSON") {
  stopTimer();
  project = nextProject;
  padsById.clear();
  project.pads.forEach((pad) => padsById.set(pad.id, pad));
  resetRun();
  updateAll();
  persistNow();
  showToast(`已从 ${sourceLabel} 载入《${project.title}》。`);
}

elements.playButton.addEventListener("click", togglePlay);
elements.pauseButton.addEventListener("click", pauseRun);
elements.resetButton.addEventListener("click", () => resetRun({ announce: true }));

elements.sequenceGrid.addEventListener("click", (event) => {
  const cell = event.target.closest(".sequence-cell");
  if (!cell) return;
  cycleStep(Number(cell.dataset.beat));
});

elements.drumPads.addEventListener("click", (event) => {
  const pad = event.target.closest(".drum-pad");
  if (!pad) return;
  strikePad(Number(pad.dataset.pad));
});

document.querySelectorAll('input[name="mode"]').forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    mode = input.value;
    if (status === "playing" || status === "paused") resetRun();
    updateCheckCard();
    persistNow();
    showToast(
      mode === "auto"
        ? "自动演示：织机会按序列逐拍演奏。"
        : "跟拍演奏：用 D F J K 在每一拍内击鼓。",
    );
  });
});

elements.title.addEventListener("input", () => {
  project.title = elements.title.value.slice(0, 30);
  persistNow();
});

elements.title.addEventListener("blur", () => {
  project.title = elements.title.value.trim() || "未命名织片";
  elements.title.value = project.title;
  persistNow();
});

elements.bpm.addEventListener("change", () => {
  project.bpm = Math.round(clamp(Number(elements.bpm.value) || 100, 40, 240));
  elements.bpm.value = String(project.bpm);
  persistNow();
});

elements.saveButton.addEventListener("click", () => {
  if (status === "finished") project.lastReport = calculateReport();
  window.clearTimeout(feedbackTimer);
  downloadProject(project, project.lastReport);
  elements.saveFeedback.textContent = "已保存";
  elements.saveFeedback.classList.add("is-visible");
  feedbackTimer = window.setTimeout(() => {
    elements.saveFeedback.classList.remove("is-visible");
  }, 1800);
  persistNow();
  showToast("作品已保存为 JSON。");
});

elements.loadButton.addEventListener("click", () => elements.fileInput.click());

elements.fileInput.addEventListener("change", async () => {
  const [file] = elements.fileInput.files;
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const nextProject = normalizeProject(parsed);
    applyLoadedProject(nextProject, file.name);
  } catch (error) {
    showToast(`载入失败：${error.message}`, 3200);
  } finally {
    elements.fileInput.value = "";
  }
});

window.addEventListener("keydown", (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  const isTyping =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target?.isContentEditable;
  if (isTyping) return;

  if (event.code === "Space") {
    event.preventDefault();
    if (status === "playing") pauseRun();
    else togglePlay();
    return;
  }

  const key = event.key.toLowerCase();
  const pad = project.pads.find((item) => item.key === key);
  if (pad) {
    event.preventDefault();
    strikePad(pad.id);
  }
});

window.addEventListener("pagehide", persistNow);

function restoreSession() {
  if (!restored) {
    updateAll();
    persistNow();
    return;
  }

  mode = restored.run.mode;
  results = cloneResults(restored.run.results);
  if (restored.run.state === "finished") {
    status = "finished";
    activeBeat = -1;
    remainingMs = 0;
  } else if (
    restored.run.state === "playing" ||
    restored.run.state === "paused"
  ) {
    status = "paused";
    activeBeat = restored.run.activeBeat >= 0 ? restored.run.activeBeat : -1;
    remainingMs =
      restored.run.remainingMs > 0
        ? restored.run.remainingMs
        : activeBeat >= 0
          ? beatDuration()
          : 0;
  } else {
    status = "idle";
    activeBeat = -1;
    remainingMs = 0;
    results = new Array(16).fill(null);
  }

  updateAll();
  loom.setResults(results);
  if (status === "finished") updateCheckCard();
  persistNow();
  if (status === "paused") {
    showToast(`已恢复上次进度：第 ${activeBeat + 1} 拍，点击继续。`, 3000);
  } else if (status === "finished") {
    showToast("已恢复上一轮完整的十六拍织纹。", 2800);
  }
}

window.virtualLoom = {
  getSnapshot() {
    return {
      status,
      activeBeat,
      remainingMs:
        status === "playing"
          ? Math.max(0, Math.round(deadline - performance.now()))
          : Math.round(remainingMs),
      mode,
      bpm: project.bpm,
      title: project.title,
      sequence: [...project.sequence],
      results: cloneResults(results),
      report: calculateReport(),
    };
  },
  start: togglePlay,
  pause: pauseRun,
  reset: resetRun,
};

restoreSession();
