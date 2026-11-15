import {
  PRE_ROLL,
  clamp,
  createTransitionRenderer,
  sampleTimeline,
  timelineLength,
} from "./transitions.js";
import { TransitionAudio } from "./audio.js";

const canvas = document.querySelector("#stage");
const ctx = canvas.getContext("2d", { alpha: false });
const renderer = createTransitionRenderer(canvas.width, canvas.height);
const audio = new TransitionAudio();

const ui = {
  state: document.querySelector("#playbackState"),
  clockA: document.querySelector("#clockA"),
  clockB: document.querySelector("#clockB"),
  phase: document.querySelector("#phaseLabel"),
  duration: document.querySelector("#duration"),
  durationOut: document.querySelector("#durationOut"),
  timeline: document.querySelector("#timeline"),
  timelineOut: document.querySelector("#timelineOut"),
  play: document.querySelector("#playButton"),
  mid: document.querySelector("#midButton"),
  export: document.querySelector("#exportButton"),
  audio: document.querySelector("#audioToggle"),
};

const state = {
  type: "push",
  direction: "rtl",
  duration: Number(ui.duration.value),
  clock: 0,
  playing: false,
  lastFrame: 0,
  raf: 0,
};

function getRadio(name) {
  return document.querySelector(`input[name="${name}"]:checked`).value;
}

function totalTime() {
  return timelineLength(state.duration);
}

function draw() {
  const timeline = renderer.renderAt(ctx, {
    time: state.clock,
    duration: state.duration,
    type: state.type,
    direction: state.direction,
  });

  ui.clockA.textContent = `${timeline.aTime.toFixed(2)}s`;
  ui.clockB.textContent =
    timeline.mode === "a" ? "待机" : `${timeline.bTime.toFixed(2)}s`;
  if (timeline.mode === "a") {
    ui.phase.textContent = "A 预跑";
  } else if (timeline.mode === "transition") {
    ui.phase.textContent = `转场 ${Math.round(timeline.phase * 100)}%`;
  } else {
    ui.phase.textContent = "B 独立运行";
  }
  ui.timelineOut.textContent = `${state.clock.toFixed(2)}s`;
  ui.timeline.value = String(state.clock);
  return timeline;
}

function syncTimelineBounds() {
  ui.timeline.max = String(totalTime());
  ui.timeline.step = "0.01";
  ui.timeline.value = String(clamp(state.clock, 0, totalTime()));
}

function startAudio() {
  if (!state.playing || !ui.audio.checked) return;
  audio.setEnabled(true);
  audio.start({
    clock: state.clock,
    duration: state.duration,
    totalTime: totalTime(),
    preRoll: PRE_ROLL,
  });
}

function tick(timestamp) {
  if (!state.playing) return;
  if (!state.lastFrame) state.lastFrame = timestamp;
  const elapsed = Math.min(0.1, (timestamp - state.lastFrame) / 1000);
  state.lastFrame = timestamp;
  state.clock = Math.min(totalTime(), state.clock + elapsed);
  draw();

  if (state.clock >= totalTime()) {
    pause(false);
    return;
  }
  state.raf = requestAnimationFrame(tick);
}

function play() {
  if (state.playing) {
    pause();
    return;
  }
  if (state.clock >= totalTime() - 0.001) state.clock = 0;
  state.playing = true;
  state.lastFrame = 0;
  ui.play.textContent = "暂停";
  ui.state.textContent = "播放中";
  ui.state.classList.add("live");
  startAudio();
  state.raf = requestAnimationFrame(tick);
}

function pause(resetLabel = true) {
  state.playing = false;
  cancelAnimationFrame(state.raf);
  state.raf = 0;
  audio.stop();
  ui.play.textContent = "播放";
  if (resetLabel) {
    ui.state.textContent = "已暂停";
    ui.state.classList.remove("live");
  } else {
    ui.state.textContent = "播放完成";
    ui.state.classList.remove("live");
  }
}

function setMidpoint() {
  pause();
  state.clock = PRE_ROLL + state.duration / 2;
  syncTimelineBounds();
  draw();
}

function exportFrame() {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const timeline = sampleTimeline(state.clock, state.duration);
    const percent = Math.round(timeline.phase * 100);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${state.type}-${state.direction}-${percent}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, "image/png");
}

document.querySelectorAll('input[name="type"]').forEach((input) => {
  input.addEventListener("change", () => {
    state.type = getRadio("type");
    draw();
  });
});

document.querySelectorAll('input[name="direction"]').forEach((input) => {
  input.addEventListener("change", () => {
    state.direction = getRadio("direction");
    draw();
  });
});

ui.duration.addEventListener("input", () => {
  state.duration = Number(ui.duration.value);
  ui.durationOut.textContent = `${state.duration.toFixed(2)}s`;
  syncTimelineBounds();
  if (state.playing) startAudio();
  draw();
});

ui.timeline.addEventListener("input", () => {
  state.clock = Number(ui.timeline.value);
  if (state.playing) startAudio();
  draw();
});

ui.play.addEventListener("click", play);
ui.mid.addEventListener("click", setMidpoint);
ui.export.addEventListener("click", exportFrame);
ui.audio.addEventListener("change", () => {
  audio.setEnabled(ui.audio.checked);
  if (state.playing && ui.audio.checked) startAudio();
});

syncTimelineBounds();
ui.durationOut.textContent = `${state.duration.toFixed(2)}s`;
draw();
