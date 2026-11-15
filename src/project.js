import { FORMAT_VERSION, findStar, clamp } from './core.js';

// A constellation:
//   starIds: ordered list of stars belonging to it
//   edges:   pairs [starIdA, starIdB] connecting two member stars
//   magRange: [min, max] global threshold band in which the constellation
//            is shown. Annotations are always preserved in the saved data;
//            this only controls display.

let sequence = 0;

export function createConstellation({
  id,
  name = '新星座',
  starIds = [],
  edges = [],
  magRange = [-1.5, 7],
  color = '#7dd3fc',
} = {}) {
  sequence += 1;
  return {
    id: id || `c${Date.now().toString(36)}_${sequence}`,
    name,
    starIds: [...starIds],
    edges: edges.map((edge) => [...edge]),
    magRange: [magRange[0], magRange[1]],
    color,
  };
}

export function renameConstellation(constellation, name) {
  const trimmed = String(name).trim();
  constellation.name = trimmed.length ? trimmed : constellation.name;
}

export function addStar(constellation, starId) {
  if (!constellation.starIds.includes(starId)) {
    constellation.starIds.push(starId);
  }
}

export function removeStar(constellation, starId) {
  constellation.starIds = constellation.starIds.filter((id) => id !== starId);
  // Drop every edge that referenced the removed star so lines never dangle.
  constellation.edges = constellation.edges.filter(
    ([a, b]) => a !== starId && b !== starId,
  );
}

// Canonical key independent of id string ordering ("s10" must not sort
// before "s2"); member indices give a stable, numeric order.
function edgeKey(constellation, a, b) {
  const ia = constellation.starIds.indexOf(a);
  const ib = constellation.starIds.indexOf(b);
  return ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
}

export function hasEdge(constellation, a, b) {
  return constellation.edges.some(([x, y]) =>
    edgeKey(constellation, x, y) === edgeKey(constellation, a, b));
}

// Toggle an edge. Both endpoints must be members of the constellation.
export function toggleEdge(constellation, a, b) {
  if (a === b || !constellation.starIds.includes(a) || !constellation.starIds.includes(b)) {
    return false;
  }
  const target = edgeKey(constellation, a, b);
  const existing = constellation.edges.findIndex(([x, y]) =>
    edgeKey(constellation, x, y) === target);
  if (existing >= 0) {
    constellation.edges.splice(existing, 1);
    return false;
  }
  constellation.edges.push([a, b]);
  return true;
}

export function setMagRange(constellation, min, max) {
  const lo = clamp(Number(min), -2, 9);
  const hi = clamp(Number(max), -2, 9);
  constellation.magRange = lo <= hi ? [lo, hi] : [hi, lo];
}

// Display-only check. The constellation and its edits are never deleted.
export function isConstellationInRange(constellation, magnitudeThreshold) {
  const [min, max] = constellation.magRange;
  return magnitudeThreshold >= min && magnitudeThreshold <= max;
}

export function constellationCenter(constellation, stars) {
  const members = constellation.starIds
    .map((id) => findStar(stars, id))
    .filter(Boolean);
  if (!members.length) return null;
  const sum = members.reduce(
    (acc, star) => ({ x: acc.x + star.x, y: acc.y + star.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / members.length, y: sum.y / members.length };
}

// ---- Project persistence ---------------------------------------------------

export function serializeProject({ seed, worldSize, magnitudeThreshold, constellations, camera }) {
  return JSON.stringify(
    {
      formatVersion: FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      seed,
      worldSize,
      magnitudeThreshold,
      constellations: constellations.map((c) => ({
        id: c.id,
        name: c.name,
        starIds: [...c.starIds],
        edges: c.edges.map((edge) => [...edge]),
        magRange: [...c.magRange],
        color: c.color,
      })),
      camera: camera.toJSON(),
    },
    null,
    2,
  );
}

// Validate against the regenerated star field so reloaded lines always point
// at real stars; unknown ids are rejected rather than silently dropped.
export function deserializeProject(text, stars) {
  const data = JSON.parse(text);
  if (!data || data.formatVersion !== FORMAT_VERSION) {
    throw new Error('不支持的工程文件版本');
  }
  if (!Array.isArray(data.constellations)) {
    throw new Error('工程文件缺少星座数据');
  }
  const ids = new Set(stars.map((star) => star.id));
  const constellations = data.constellations.map((raw, index) => {
    for (const starId of raw.starIds ?? []) {
      if (!ids.has(starId)) throw new Error(`星座 ${index} 引用了不存在的星点 ${starId}`);
    }
    for (const edge of raw.edges ?? []) {
      if (!ids.has(edge[0]) || !ids.has(edge[1])) {
        throw new Error(`星座 ${index} 的连线引用了不存在的星点`);
      }
    }
    const c = createConstellation({
      id: raw.id,
      name: String(raw.name ?? '未命名'),
      starIds: raw.starIds ?? [],
      edges: raw.edges ?? [],
      magRange: raw.magRange ?? [-1.5, 7],
      color: raw.color ?? '#7dd3fc',
    });
    return c;
  });
  return {
    seed: data.seed,
    worldSize: data.worldSize,
    magnitudeThreshold: Number(data.magnitudeThreshold ?? 7),
    constellations,
    cameraJSON: data.camera ?? null,
  };
}
