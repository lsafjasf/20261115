import {
  DIRECTIONS,
  PRE_ROLL,
  TRANSITION_TYPES,
  clamp,
  createTransitionRenderer,
  sampleTimeline,
} from "../src/transitions.js";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") || "compare";
const progress = clamp(Number(params.get("progress") ?? 0.5));
const duration = Math.max(0.1, Number(params.get("duration") ?? 2));
const direction = DIRECTIONS.includes(params.get("direction"))
  ? params.get("direction")
  : "rtl";
const root = document.querySelector("#root");

function makePanel(label, width, height) {
  const figure = document.createElement("figure");
  figure.className = "panel";
  const caption = document.createElement("figcaption");
  caption.textContent = label;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  figure.append(caption, canvas);
  root.append(figure);
  return canvas;
}

function drawCapture(canvas, type, phase) {
  const renderer = createTransitionRenderer(canvas.width, canvas.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  const clock = PRE_ROLL + duration * phase;
  const timeline = renderer.renderAt(ctx, {
    time: clock,
    duration,
    type,
    direction,
  });
  canvas.dataset.type = type;
  canvas.dataset.direction = direction;
  canvas.dataset.phase = String(phase);
  canvas.dataset.aTime = timeline.aTime.toFixed(2);
  canvas.dataset.bTime = timeline.bTime.toFixed(2);
}

if (mode === "single") {
  root.classList.add("single");
  const type = TRANSITION_TYPES.includes(params.get("type"))
    ? params.get("type")
    : "fog";
  const canvas = makePanel("", 640, 360);
  drawCapture(canvas, type, progress);
} else {
  const percent = Math.round(progress * 100);
  for (const type of TRANSITION_TYPES) {
    const canvas = makePanel(`${type} @${percent}% ${direction}`, 640, 360);
    drawCapture(canvas, type, progress);
  }
}

const sample = sampleTimeline(PRE_ROLL + duration * progress, duration);
document.body.dataset.ready = "true";
document.body.dataset.aTime = sample.aTime.toFixed(2);
document.body.dataset.bTime = sample.bTime.toFixed(2);
document.body.dataset.phase = sample.phase.toFixed(3);
