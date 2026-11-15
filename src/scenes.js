export const WIDTH = 1280;
export const HEIGHT = 720;
export const DURATION = 8;
export const FPS = 30;

export const LAYER_ORDER = ["background", "midground", "foreground"];

export const LAYER_META = {
  background: {
    id: "background",
    label: "背景",
    short: "BG",
    z: 0,
    depth: 0.82,
    color: "#7c9b94",
    anchor: { x: 0.75, y: 0.33 },
    parallax: 1.5,
  },
  midground: {
    id: "midground",
    label: "中景",
    short: "MG",
    z: 1,
    depth: 0.52,
    color: "#d3a75f",
    anchor: { x: 0.47, y: 0.53 },
    parallax: 4,
  },
  foreground: {
    id: "foreground",
    label: "前景",
    short: "FG",
    z: 2,
    depth: 0.18,
    color: "#d8e3db",
    anchor: { x: 0.2, y: 0.7 },
    parallax: 7,
  },
};

const grovePath = [
  { x: 0.2, y: 0.7 },
  { x: 0.3, y: 0.56 },
  { x: 0.59, y: 0.45 },
  { x: 0.75, y: 0.33 },
];

const harborPath = [
  { x: 0.21, y: 0.72 },
  { x: 0.3, y: 0.58 },
  { x: 0.58, y: 0.47 },
  { x: 0.77, y: 0.36 },
];

export const SCENES = [
  {
    id: "grove",
    index: "01",
    name: "雾岭晨光",
    subtitle: "MIST / PINES",
    accent: "#d6b06b",
    base: "#102523",
    layers: {
      background: { blur: 12, appear: 0, fade: 0.8 },
      midground: { blur: 8, appear: 0.08, fade: 1.05 },
      foreground: { blur: 4, appear: 0.24, fade: 1.2 },
    },
    focus: { points: grovePath },
  },
  {
    id: "harbor",
    index: "02",
    name: "雾港夜航",
    subtitle: "HARBOR / NIGHT",
    accent: "#7fc6c9",
    base: "#08151f",
    layers: {
      background: { blur: 14, appear: 0, fade: 0.75 },
      midground: { blur: 7, appear: 0.12, fade: 1 },
      foreground: { blur: 3.5, appear: 0.18, fade: 1.35 },
    },
    focus: { points: harborPath },
  },
];

export function cloneScenes() {
  return JSON.parse(JSON.stringify(SCENES));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function smoothstep(min, max, value) {
  const x = clamp((value - min) / (max - min), 0, 1);
  return x * x * (3 - 2 * x);
}

export function cubicPoint(points, t) {
  const p = clamp(t, 0, 1);
  const u = 1 - p;
  const a = u * u * u;
  const b = 3 * u * u * p;
  const c = 3 * u * p * p;
  const d = p * p * p;
  return {
    x: a * points[0].x + b * points[1].x + c * points[2].x + d * points[3].x,
    y: a * points[0].y + b * points[1].y + c * points[2].y + d * points[3].y,
  };
}

export function appearanceOpacity(layer, time) {
  if (time < layer.appear) return 0;
  return smoothstep(layer.appear, layer.appear + layer.fade, time);
}

export function evaluateScene(scene, time) {
  const t = clamp(time, 0, DURATION);
  const progress = t / DURATION;
  const focus = cubicPoint(scene.focus.points, progress);
  let focusedLayer = "background";
  let closest = Infinity;

  const layers = LAYER_ORDER.map((id) => {
    const config = scene.layers[id];
    const meta = LAYER_META[id];
    const distance = Math.hypot(focus.x - meta.anchor.x, focus.y - meta.anchor.y);
    if (distance < closest) {
      closest = distance;
      focusedLayer = id;
    }
    const proximity = 1 - smoothstep(0.07, 0.5, distance);
    const opacity = appearanceOpacity(config, t);
    const blur = config.blur * (1 - 0.78 * proximity);
    return {
      id,
      z: meta.z,
      opacity,
      blur: Math.max(0, blur),
      distance,
      proximity,
      config: { ...config },
    };
  });

  return { time: t, progress, focus, focusedLayer, layers };
}

export function rgba(hex, alpha) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
