export const AXES = ["position", "scale", "rotation", "focus"];

export const AXIS_META = {
  position: { label: "位置", color: "#ff8259", unit: "px" },
  scale: { label: "缩放", color: "#83bff7", unit: "×" },
  rotation: { label: "旋转", color: "#efca67", unit: "°" },
  focus: { label: "焦点", color: "#73dcc0", unit: "%" },
};

export const EASING_PRESETS = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  smooth: [0.42, 0, 0.58, 1],
};

const DEFAULT_EASING = {
  position: [0.42, 0, 0.2, 1],
  scale: [0.3, 0, 0.22, 1],
  rotation: [0.36, 0, 0.18, 1],
  focus: [0.42, 0, 0.26, 1],
};

export function createSampleProject() {
  const keys = [
    {
      time: 0,
      values: { position: { x: 430, y: 288 }, scale: 1.12, rotation: -3, focus: { x: -48, y: 8 } },
      easing: { position: [0.4, 0, 0.2, 1], scale: [0.28, 0, 0.22, 1], rotation: [0.42, 0, 0.2, 1], focus: [0.36, 0, 0.24, 1] },
    },
    {
      time: 1.3,
      values: { position: { x: 515, y: 245 }, scale: 1.26, rotation: 2, focus: { x: -20, y: -15 } },
      easing: { position: [0.34, 0, 0.16, 1], scale: [0.2, 0.4, 0.24, 1], rotation: [0.3, 0, 0.22, 1], focus: [0.4, 0, 0.18, 1] },
    },
    {
      time: 2.8,
      values: { position: { x: 590, y: 270 }, scale: 1.42, rotation: 5, focus: { x: 45, y: 5 } },
      easing: { position: [0.28, 0, 0.18, 1], scale: [0.38, 0, 0.2, 1], rotation: [0.46, 0, 0.15, 1], focus: [0.32, 0, 0.3, 1] },
    },
    {
      time: 4.5,
      values: { position: { x: 500, y: 330 }, scale: 1.18, rotation: -2, focus: { x: 60, y: 32 } },
      easing: { position: [0.46, 0, 0.22, 1], scale: [0.3, 0, 0.3, 1], rotation: [0.38, 0, 0.2, 1], focus: [0.44, 0, 0.16, 1] },
    },
    {
      time: 6.2,
      values: { position: { x: 390, y: 295 }, scale: 1.32, rotation: -6, focus: { x: -30, y: 18 } },
      easing: { position: [0.36, 0, 0.14, 1], scale: [0.25, 0, 0.26, 1], rotation: [0.42, 0, 0.18, 1], focus: [0.34, 0, 0.22, 1.02] },
    },
    {
      time: 8,
      values: { position: { x: 480, y: 270 }, scale: 1.05, rotation: 0, focus: { x: 0, y: 0 } },
      easing: cloneEasing(DEFAULT_EASING),
    },
  ];

  return {
    format: "cutline.camera-shot",
    version: 1,
    name: "屋顶穿行",
    subtitle: "ROOFTOP PASS",
    duration: 8,
    fps: 24,
    stage: { width: 960, height: 540 },
    camera: { baseWidth: 620, baseHeight: 348.75 },
    sound: { enabled: false, bpm: 96, note: "节拍参考不参与动画计算" },
    axes: AXES,
    keyframes: keys,
  };
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneEasing(source) {
  return Object.fromEntries(Object.entries(source).map(([axis, curve]) => [axis, [...curve]]));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function cubicBezierComponent(t, p1, p2) {
  const inv = 1 - t;
  return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
}

export function solveBezierTime(progress, x1, x2) {
  const target = clamp(progress, 0, 1);
  let low = 0;
  let high = 1;
  let t = target;

  for (let i = 0; i < 10; i += 1) {
    const x = cubicBezierComponent(t, x1, x2);
    if (Math.abs(x - target) < 0.00004) return t;
    if (x < target) low = t;
    else high = t;
    t = (low + high) / 2;
  }

  return t;
}

export function easedProgress(progress, easing = EASING_PRESETS.smooth) {
  const curve = Array.isArray(easing) && easing.length === 4 ? easing : EASING_PRESETS.smooth;
  const t = solveBezierTime(progress, curve[0], curve[2]);
  return cubicBezierComponent(t, curve[1], curve[3]);
}

export function normalizeEasing(easing, axis = "position") {
  const fallback = DEFAULT_EASING[axis] || DEFAULT_EASING.position;
  if (!Array.isArray(easing) || easing.length !== 4 || easing.some((n) => !Number.isFinite(n))) {
    return [...fallback];
  }
  return [
    clamp(easing[0], 0, 1),
    clamp(easing[1], -0.4, 1.4),
    clamp(easing[2], 0, 1),
    clamp(easing[3], -0.4, 1.4),
  ];
}

export function normalizeProject(source) {
  const fallback = createSampleProject();
  if (!source || typeof source !== "object" || !Array.isArray(source.keyframes)) return fallback;

  const project = clone(source);
  project.format = project.format || "cutline.camera-shot";
  project.version = 1;
  project.name = project.name || fallback.name;
  project.subtitle = project.subtitle || fallback.subtitle;
  project.duration = Number(project.duration) || fallback.duration;
  project.fps = Number(project.fps) || fallback.fps;
  project.stage = {
    width: Number(project.stage?.width) || fallback.stage.width,
    height: Number(project.stage?.height) || fallback.stage.height,
  };
  project.camera = {
    baseWidth: Number(project.camera?.baseWidth) || fallback.camera.baseWidth,
    baseHeight: Number(project.camera?.baseHeight) || fallback.camera.baseHeight,
  };
  project.sound = { ...fallback.sound, ...(project.sound || {}) };
  project.axes = AXES;
  project.keyframes = project.keyframes
    .filter((key) => key && Number.isFinite(Number(key.time)))
    .map((key) => ({
      time: clamp(Number(key.time), 0, project.duration),
      values: {
        position: {
          x: Number(key.values?.position?.x) || 0,
          y: Number(key.values?.position?.y) || 0,
        },
        scale: clamp(Number(key.values?.scale) || 1, 0.1, 10),
        rotation: Number(key.values?.rotation) || 0,
        focus: {
          x: Number(key.values?.focus?.x) || 0,
          y: Number(key.values?.focus?.y) || 0,
        },
      },
      easing: Object.fromEntries(AXES.map((axis) => [axis, normalizeEasing(key.easing?.[axis], axis)])),
    }))
    .sort((a, b) => a.time - b.time);

  if (!project.keyframes.length) project.keyframes = fallback.keyframes;
  return project;
}

export function projectToJSON(project) {
  return JSON.stringify(project, null, 2);
}

export function findSegmentIndex(project, time) {
  const keys = project.keyframes;
  if (time <= keys[0].time) return 0;
  if (time >= keys[keys.length - 1].time) return Math.max(0, keys.length - 2);
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (time >= keys[i].time && time <= keys[i + 1].time) return i;
  }
  return Math.max(0, keys.length - 2);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function sampleValues(project, time) {
  const keys = project.keyframes;
  if (!keys.length) return null;
  if (time <= keys[0].time) return clone(keys[0].values);
  if (time >= keys[keys.length - 1].time) return clone(keys[keys.length - 1].values);

  const index = findSegmentIndex(project, time);
  const from = keys[index];
  const to = keys[index + 1];
  const span = Math.max(0.00001, to.time - from.time);
  const linearProgress = clamp((time - from.time) / span, 0, 1);
  const eased = {};

  AXES.forEach((axis) => {
    eased[axis] = easedProgress(linearProgress, normalizeEasing(from.easing?.[axis], axis));
  });

  return {
    position: {
      x: lerp(from.values.position.x, to.values.position.x, eased.position),
      y: lerp(from.values.position.y, to.values.position.y, eased.position),
    },
    scale: lerp(from.values.scale, to.values.scale, eased.scale),
    rotation: lerp(from.values.rotation, to.values.rotation, eased.rotation),
    focus: {
      x: lerp(from.values.focus.x, to.values.focus.x, eased.focus),
      y: lerp(from.values.focus.y, to.values.focus.y, eased.focus),
    },
  };
}

export function frameGeometry(project, values = sampleValues(project, 0)) {
  const width = project.camera.baseWidth / Math.max(0.1, values.scale);
  const height = project.camera.baseHeight / Math.max(0.1, values.scale);
  const theta = (values.rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const center = values.position;

  const mapLocal = (x, y) => ({
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  });

  const halfW = width / 2;
  const halfH = height / 2;
  const corners = {
    topLeft: mapLocal(-halfW, -halfH),
    topRight: mapLocal(halfW, -halfH),
    bottomRight: mapLocal(halfW, halfH),
    bottomLeft: mapLocal(-halfW, halfH),
  };
  const focus = mapLocal((values.focus.x / 100) * halfW, (values.focus.y / 100) * halfH);

  return {
    width,
    height,
    scale: values.scale,
    center: { x: center.x, y: center.y },
    focus,
    rotation: values.rotation,
    corners,
    points: [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft],
  };
}

export function getBoundsViolation(project, sampleStep = 1 / 60) {
  const duration = project.duration;
  const steps = Math.max(1, Math.ceil(duration / sampleStep));
  let worst = null;

  for (let i = 0; i <= steps; i += 1) {
    const time = Math.min(duration, i * sampleStep);
    const values = sampleValues(project, time);
    const frame = frameGeometry(project, values);
    frame.points.forEach((point) => {
      const sides = [
        { side: "左", overshoot: -point.x },
        { side: "右", overshoot: point.x - project.stage.width },
        { side: "上", overshoot: -point.y },
        { side: "下", overshoot: point.y - project.stage.height },
      ];
      sides.forEach((item) => {
        if (item.overshoot > 0.5 && (!worst || item.overshoot > worst.overshoot)) {
          worst = { ...item, time, values, frame };
        }
      });
    });
  }

  return worst;
}

export function sampleRoute(project, step = 0.08) {
  const points = [];
  const count = Math.max(2, Math.ceil(project.duration / step));
  for (let i = 0; i <= count; i += 1) {
    const time = (i / count) * project.duration;
    const values = sampleValues(project, time);
    points.push({ time, x: values.position.x, y: values.position.y, values });
  }
  return points;
}

export function keyframeNear(project, time, tolerance = 0.06) {
  return project.keyframes.findIndex((key) => Math.abs(key.time - time) <= tolerance);
}

export function formatTimecode(seconds, fps = 24) {
  const totalFrames = Math.round(clamp(seconds, 0, 86400) * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const secs = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return [hours, minutes, secs, frames].map((part) => String(part).padStart(2, "0")).join(":");
}

export function formatSeconds(time) {
  return `${time.toFixed(1)}s`;
}

export function axisNumericValues(axis, values) {
  if (axis === "position") return [values.position.x, values.position.y];
  if (axis === "scale") return [values.scale];
  if (axis === "rotation") return [values.rotation];
  return [values.focus.x, values.focus.y];
}

export function verifyRestoration(original, reloaded, samples = 49) {
  const times = new Set();
  const keyTimes = original.keyframes.flatMap((key) => [key.time]);
  keyTimes.forEach((time) => times.add(Number(time.toFixed(5))));
  for (let i = 0; i <= samples; i += 1) {
    times.add(Number(((i / samples) * original.duration).toFixed(5)));
  }
  const sortedTimes = [...times].sort((a, b) => a - b);

  return AXES.map((axis) => {
    let maxDelta = 0;
    sortedTimes.forEach((time) => {
      const a = axisNumericValues(axis, sampleValues(original, time));
      const b = axisNumericValues(axis, sampleValues(reloaded, time));
      a.forEach((value, index) => {
        maxDelta = Math.max(maxDelta, Math.abs(value - b[index]));
      });
    });
    return {
      axis,
      label: AXIS_META[axis].label,
      color: AXIS_META[axis].color,
      samples: sortedTimes.length,
      maxDelta,
      ok: maxDelta < 0.0001,
    };
  });
}

export function projectFingerprint(project) {
  const payload = projectToJSON(project);
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${project.duration}:${project.keyframes.length}:${(hash >>> 0).toString(16)}`;
}
