import { HEIGHT, LAYER_META, WIDTH, evaluateScene, rgba } from "./scenes.js";
import { buildGroveArt, buildHarborArt } from "./art.js";

let artCache = null;

function getArt() {
  if (!artCache) {
    artCache = {
      grove: buildGroveArt(),
      harbor: buildHarborArt(),
    };
  }
  return artCache;
}

function tracePath(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x * WIDTH, points[0].y * HEIGHT);
  ctx.bezierCurveTo(
    points[1].x * WIDTH,
    points[1].y * HEIGHT,
    points[2].x * WIDTH,
    points[2].y * HEIGHT,
    points[3].x * WIDTH,
    points[3].y * HEIGHT,
  );
}

function drawEditorOverlay(ctx, scene, state, selectedHandle) {
  const accent = scene.accent;
  const panelAlpha = 0.84;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([5, 8]);
  ctx.strokeStyle = rgba(accent, 0.34);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(scene.focus.points[0].x * WIDTH, scene.focus.points[0].y * HEIGHT);
  for (let i = 1; i < scene.focus.points.length; i += 1) {
    ctx.lineTo(scene.focus.points[i].x * WIDTH, scene.focus.points[i].y * HEIGHT);
  }
  ctx.stroke();

  ctx.setLineDash([]);
  tracePath(ctx, scene.focus.points);
  ctx.strokeStyle = rgba("#06100f", 0.68);
  ctx.lineWidth = 5.5;
  ctx.stroke();
  ctx.strokeStyle = rgba(accent, 0.94);
  ctx.lineWidth = 1.6;
  ctx.shadowColor = rgba(accent, 0.7);
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;

  scene.focus.points.forEach((point, index) => {
    const x = point.x * WIDTH;
    const y = point.y * HEIGHT;
    const selected = selectedHandle === index;
    ctx.beginPath();
    ctx.arc(x, y, selected ? 11 : 7.5, 0, Math.PI * 2);
    ctx.fillStyle = rgba("#071211", 0.82);
    ctx.fill();
    ctx.lineWidth = selected ? 2.5 : 1.4;
    ctx.strokeStyle = rgba(accent, selected ? 1 : 0.8);
    ctx.stroke();
    ctx.fillStyle = rgba(accent, 0.9);
    ctx.font = '500 9px "DM Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), x, y + 0.5);
  });

  const fx = state.focus.x * WIDTH;
  const fy = state.focus.y * HEIGHT;
  ctx.strokeStyle = rgba("#f4f1df", 0.72);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(fx, fy, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = rgba(accent, 0.92);
  ctx.beginPath();
  ctx.arc(fx, fy, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(fx - 47, fy);
  ctx.lineTo(fx - 27, fy);
  ctx.moveTo(fx + 27, fy);
  ctx.lineTo(fx + 47, fy);
  ctx.moveTo(fx, fy - 47);
  ctx.lineTo(fx, fy - 27);
  ctx.moveTo(fx, fy + 27);
  ctx.lineTo(fx, fy + 47);
  ctx.stroke();

  const focusLabel = LAYER_META[state.focusedLayer].short;
  ctx.font = '500 10px "DM Mono", monospace';
  const label = `FOCUS ${focusLabel}  ${Math.round(state.progress * 100)
    .toString()
    .padStart(2, "0")}%`;
  const labelWidth = ctx.measureText(label).width + 24;
  ctx.fillStyle = rgba("#061211", panelAlpha);
  ctx.beginPath();
  ctx.roundRect(fx + 43, fy - 43, labelWidth, 25, 5);
  ctx.fill();
  ctx.strokeStyle = rgba(accent, 0.3);
  ctx.stroke();
  ctx.fillStyle = rgba("#e9e5d4", 0.88);
  ctx.textAlign = "left";
  ctx.fillText(label, fx + 55, fy - 30);

  ctx.restore();
}

function drawAtmosphere(ctx, scene, state) {
  const fx = state.focus.x * WIDTH;
  const fy = state.focus.y * HEIGHT;
  const vignette = ctx.createRadialGradient(
    fx,
    fy,
    WIDTH * 0.1,
    fx,
    fy,
    WIDTH * 0.76,
  );
  vignette.addColorStop(0, "rgba(2, 7, 8, 0)");
  vignette.addColorStop(0.62, "rgba(2, 7, 8, 0.06)");
  vignette.addColorStop(1, "rgba(2, 7, 8, 0.46)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const wash = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  wash.addColorStop(0, rgba(scene.accent, 0.025));
  wash.addColorStop(0.58, "rgba(0, 0, 0, 0)");
  wash.addColorStop(1, rgba(scene.accent, 0.035));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.art = getArt();
  }

  render(scene, time, options = {}) {
    const { editor = false, selectedHandle = -1 } = options;
    const ctx = this.ctx;
    const state = evaluateScene(scene, time);
    const art = this.art[scene.id];

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.fillStyle = scene.base;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const layers = state.layers.slice().sort((a, b) => a.z - b.z);
    layers.forEach((layer) => {
      if (layer.opacity <= 0.0001 || layer.blur > 80) return;
      const meta = LAYER_META[layer.id];
      const shiftX = (state.focus.x - 0.5) * meta.parallax * 2.3;
      const shiftY = (state.focus.y - 0.5) * meta.parallax * 0.7;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.filter = layer.blur > 0.04 ? `blur(${layer.blur.toFixed(2)}px)` : "none";
      ctx.translate(shiftX, shiftY);
      ctx.drawImage(art[layer.id], 0, 0, WIDTH, HEIGHT);
      ctx.restore();
    });

    drawAtmosphere(ctx, scene, state);
    if (editor) drawEditorOverlay(ctx, scene, state, selectedHandle);
    ctx.restore();
    return state;
  }

  snapshot() {
    return this.canvas.toDataURL("image/png");
  }
}

export function hitTestHandle(scene, point) {
  let result = -1;
  let closest = 0.05;
  scene.focus.points.forEach((handle, index) => {
    const distance = Math.hypot(point.x - handle.x, point.y - handle.y);
    if (distance < closest) {
      closest = distance;
      result = index;
    }
  });
  return result;
}
