export const DURATION = 12;
export const BPM = 120;
export const WIDTH = 1080;
export const HEIGHT = 1350;
export const PROPERTIES = ["position", "opacity", "color"];

export const PROPERTY_LABELS = {
  position: "位移",
  opacity: "不透明",
  color: "颜色",
};

const round = (value, precision = 100) =>
  Math.round(Number(value) * precision) / precision;

export function normalizeTime(time) {
  const wrapped = Number(time) % DURATION;
  return wrapped < 0 ? wrapped + DURATION : wrapped;
}

export function createDefaultProject() {
  return {
    version: 1,
    name: "NIGHT / SIGNAL",
    width: WIDTH,
    height: HEIGHT,
    duration: DURATION,
    bpm: BPM,
    layers: [
      {
        id: "background",
        name: "几何背景",
        type: "VECTOR",
        kind: "shapes",
        visible: true,
        color: "#ff5c35",
        tracks: {
          position: [
            { t: 0, x: 0, y: 0 },
            { t: 2.5, x: -44, y: 26 },
            { t: 5, x: -8, y: -18 },
            { t: 7.5, x: 42, y: 22 },
            { t: 10, x: 20, y: -10 },
            { t: 12, x: 0, y: 0 },
          ],
          opacity: [
            { t: 0, v: 1 },
            { t: 3, v: 0.88 },
            { t: 6, v: 1 },
            { t: 9, v: 0.84 },
            { t: 12, v: 1 },
          ],
          color: [
            { t: 0, v: "#ff5c35" },
            { t: 3, v: "#ffd65c" },
            { t: 6, v: "#ff5c35" },
            { t: 9, v: "#9fe7f1" },
            { t: 12, v: "#ff5c35" },
          ],
        },
      },
      {
        id: "title",
        name: "主标题",
        type: "TEXT",
        kind: "title",
        visible: true,
        color: "#f2eee3",
        tracks: {
          position: [
            { t: 0, x: 0, y: 0 },
            { t: 1.5, x: 0, y: -18 },
            { t: 3, x: 18, y: 0 },
            { t: 4.5, x: 0, y: 0 },
            { t: 6, x: -24, y: 12 },
            { t: 7.5, x: 0, y: -8 },
            { t: 9, x: 24, y: 0 },
            { t: 10.5, x: 0, y: 10 },
            { t: 12, x: 0, y: 0 },
          ],
          opacity: [
            { t: 0, v: 1 },
            { t: 0.6, v: 1 },
            { t: 5.4, v: 1 },
            { t: 5.8, v: 0.32 },
            { t: 6.2, v: 1 },
            { t: 11.4, v: 1 },
            { t: 12, v: 1 },
          ],
          color: [
            { t: 0, v: "#f2eee3" },
            { t: 3, v: "#f2eee3" },
            { t: 6, v: "#ff805e" },
            { t: 9, v: "#f2eee3" },
            { t: 12, v: "#f2eee3" },
          ],
        },
      },
      {
        id: "info",
        name: "底部活动信息",
        type: "TEXT",
        kind: "info",
        visible: true,
        color: "#f2eee3",
        tracks: {
          position: [
            { t: 0, x: 0, y: 18 },
            { t: 1.2, x: 0, y: 0 },
            { t: 6, x: 12, y: 0 },
            { t: 9, x: 0, y: -4 },
            { t: 12, x: 0, y: 18 },
          ],
          opacity: [
            { t: 0, v: 1 },
            { t: 0.9, v: 1 },
            { t: 8.5, v: 1 },
            { t: 9.4, v: 0.55 },
            { t: 10, v: 1 },
            { t: 12, v: 1 },
          ],
          color: [
            { t: 0, v: "#f2eee3" },
            { t: 4, v: "#f2eee3" },
            { t: 6, v: "#d9ff65" },
            { t: 8, v: "#f2eee3" },
            { t: 12, v: "#f2eee3" },
          ],
        },
      },
    ],
  };
}

function fallback(property, layer) {
  if (property === "position") return { x: 0, y: 0 };
  if (property === "opacity") return { v: 1 };
  return { v: layer.color || "#ffffff" };
}

function interpolateColor(from, to, amount) {
  const a = from.replace("#", "");
  const b = to.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const start = parseInt(a.slice(offset, offset + 2), 16);
    const end = parseInt(b.slice(offset, offset + 2), 16);
    return Math.round(start + (end - start) * amount)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

export function sampleTrack(layer, property, time) {
  const track = layer.tracks?.[property] || [];
  if (!track.length) return fallback(property, layer);

  const t = normalizeTime(time);
  if (t <= track[0].t) {
    return property === "position"
      ? { x: track[0].x || 0, y: track[0].y || 0 }
      : { v: track[0].v };
  }

  const last = track[track.length - 1];
  if (t >= last.t) {
    return property === "position"
      ? { x: last.x || 0, y: last.y || 0 }
      : { v: last.v };
  }

  for (let index = 0; index < track.length - 1; index += 1) {
    const from = track[index];
    const to = track[index + 1];
    if (t < from.t || t > to.t) continue;
    const span = Math.max(0.0001, to.t - from.t);
    const amount = (t - from.t) / span;
    if (property === "position") {
      return {
        x: from.x + (to.x - from.x) * amount,
        y: from.y + (to.y - from.y) * amount,
      };
    }
    if (property === "opacity") {
      return { v: from.v + (to.v - from.v) * amount };
    }
    return { v: interpolateColor(from.v, to.v, amount) };
  }

  return fallback(property, layer);
}

export function evaluateLayer(layer, time) {
  return {
    position: sampleTrack(layer, "position", time),
    opacity: sampleTrack(layer, "opacity", time).v,
    color: sampleTrack(layer, "color", time).v,
  };
}

export function currentKeyframe(track, time, tolerance = 0.025) {
  return track.find((key) => Math.abs(key.t - time) <= tolerance);
}

export function keyframeValue(layer, property, time) {
  const sampled = sampleTrack(layer, property, normalizeTime(time));
  return sampled;
}

export function setKeyframe(project, layerId, property, time, value) {
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) return null;
  const t = round(normalizeTime(time));
  const track = layer.tracks[property];
  const existing = currentKeyframe(track, t);
  if (existing) {
    Object.assign(existing, { ...value, t });
    return existing;
  }

  const key = { t, ...value };
  track.push(key);
  track.sort((a, b) => a.t - b.t);
  return key;
}

export function toggleKeyframe(project, layerId, property, time) {
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) return { added: false };
  const t = round(normalizeTime(time));
  const track = layer.tracks[property];
  const existing = currentKeyframe(track, t);
  if (existing) {
    layer.tracks[property] = track.filter((key) => key !== existing);
    return { added: false, key: existing };
  }
  const sampled = sampleTrack(layer, property, t);
  return {
    added: true,
    key: setKeyframe(project, layerId, property, t, sampled),
  };
}

export function addAllKeyframes(project, layerId, time) {
  const layer = project.layers.find((item) => item.id === layerId);
  if (!layer) return [];
  return PROPERTIES.map((property) =>
    setKeyframe(
      project,
      layerId,
      property,
      time,
      sampleTrack(layer, property, time),
    ),
  );
}

export function nearestKeyframe(layer, property, time, tolerance = 0.12) {
  const track = layer.tracks?.[property] || [];
  let nearest = null;
  let distance = Infinity;
  track.forEach((key) => {
    const delta = Math.abs(key.t - normalizeTime(time));
    if (delta < distance) {
      nearest = key;
      distance = delta;
    }
  });
  return distance <= tolerance ? nearest : null;
}

export function countKeyframes(layer) {
  return PROPERTIES.reduce(
    (total, property) => total + (layer.tracks?.[property]?.length || 0),
    0,
  );
}

export function validateProject(project) {
  if (!project || !Array.isArray(project.layers)) {
    throw new Error("工程文件缺少 layers 数组");
  }
  if (Number(project.duration) !== DURATION) {
    throw new Error("仅支持 12 秒工程");
  }
  const layers = project.layers.map((layer) => {
    if (!layer.id || !layer.name || !layer.kind || !layer.tracks) {
      throw new Error("图层数据不完整");
    }
    const tracks = {};
    PROPERTIES.forEach((property) => {
      tracks[property] = Array.isArray(layer.tracks[property])
        ? layer.tracks[property]
            .filter((key) => Number.isFinite(Number(key.t)))
            .map((key) => ({ ...key, t: Math.max(0, Math.min(DURATION, Number(key.t))) }))
            .sort((a, b) => a.t - b.t)
        : [];
    });
    return { ...layer, visible: layer.visible !== false, tracks };
  });
  return {
    ...project,
    name: project.name || "UNTITLED / LOOP",
    width: WIDTH,
    height: HEIGHT,
    duration: DURATION,
    bpm: BPM,
    layers,
  };
}

export function formatTime(time, includeMinutes = true) {
  const safe = Math.max(0, Math.min(DURATION, Number(time) || 0));
  const seconds = safe.toFixed(2).padStart(5, "0");
  return includeMinutes ? `00:${seconds}` : seconds;
}

export function frameAt(time) {
  return Math.min(359, Math.floor(normalizeTime(time) * 30));
}
