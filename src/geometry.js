export const EPSILON = 1e-7;

export const FACE_META = [
  { id: "F1", name: "底面", short: "BASE", color: "#dce9df", accent: "#56806d" },
  { id: "F2", name: "顶面", short: "TOP", color: "#f4e6ce", accent: "#b37b43" },
  { id: "F3", name: "背面", short: "BACK", color: "#e2e7ed", accent: "#657a94" },
  { id: "F4", name: "右面", short: "RIGHT", color: "#f0ded6", accent: "#ad6b55" },
  { id: "F5", name: "正面", short: "FRONT", color: "#e8e3d5", accent: "#927957" },
  { id: "F6", name: "左面", short: "LEFT", color: "#dce8e8", accent: "#527f82" },
];

export const FACE_VERTICES = {
  F1: [0, 1, 2, 3],
  F2: [4, 7, 6, 5],
  F3: [0, 4, 5, 1],
  F4: [1, 5, 6, 2],
  F5: [2, 6, 7, 3],
  F6: [3, 7, 4, 0],
};

export const UNFOLD_TREE = [
  { face: "F1", parent: null, hinge: null },
  { face: "F3", parent: "F1", hinge: [0, 1] },
  { face: "F4", parent: "F1", hinge: [1, 2] },
  { face: "F5", parent: "F1", hinge: [2, 3] },
  { face: "F6", parent: "F1", hinge: [3, 0] },
  { face: "F2", parent: "F5", hinge: [6, 7] },
];

export const VERTEX_IDS = Array.from({ length: 8 }, (_, index) => index);

const DEFAULT_POSITIONS = [
  [-1.25, -0.9, -0.78],
  [1.25, -0.9, -0.78],
  [1.25, -0.9, 0.78],
  [-1.25, -0.9, 0.78],
  [-1.25, 0.9, -0.78],
  [1.25, 0.9, -0.78],
  [1.25, 0.9, 0.78],
  [-1.25, 0.9, 0.78],
];

export function createDefaultVertices() {
  return DEFAULT_POSITIONS.map((position, id) => ({ id, position: [...position] }));
}

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, factor) => [a[0] * factor, a[1] * factor, a[2] * factor];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a) {
  const magnitude = length(a);
  return magnitude > EPSILON ? scale(a, 1 / magnitude) : [0, 0, 0];
}

export function distance(a, b) {
  return length(sub(a, b));
}

export function polygonArea2D(polygon) {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

export function polygonCentroid2D(polygon) {
  let x = 0;
  let y = 0;
  for (const point of polygon) {
    x += point[0];
    y += point[1];
  }
  return [x / polygon.length, y / polygon.length];
}

export function polygonBounds(polygons) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y] of polygon) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function faceNormal(points) {
  const normal = [0, 0, 0];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    normal[0] += (current[1] - next[1]) * (current[2] + next[2]);
    normal[1] += (current[2] - next[2]) * (current[0] + next[0]);
    normal[2] += (current[0] - next[0]) * (current[1] + next[1]);
  }
  return normalize(normal);
}

export function flattenFace(vertexPositions, vertexIds) {
  const points = vertexIds.map((id) => vertexPositions[id]);
  const normal = faceNormal(points);
  const rawEdge = sub(points[1], points[0]);
  const projectedEdge = sub(rawEdge, scale(normal, dot(rawEdge, normal)));
  const u = normalize(projectedEdge);
  let v = normalize(cross(normal, u));

  const project = (point) => {
    const planar = sub(point, scale(normal, dot(sub(point, points[0]), normal)));
    const local = sub(planar, points[0]);
    return [dot(local, u), dot(local, v)];
  };

  let polygon = points.map(project);
  if (polygonArea2D(polygon) < 0) {
    v = scale(v, -1);
    polygon = points.map(project);
  }

  return { polygon, normal, u, v };
}

function directedEdgeIndex(vertexIds, pair) {
  for (let index = 0; index < vertexIds.length; index += 1) {
    const current = vertexIds[index];
    const next = vertexIds[(index + 1) % vertexIds.length];
    if (current === pair[0] && next === pair[1]) return index;
    if (current === pair[1] && next === pair[0]) return index;
  }
  return -1;
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function rotateAndPlace(polygon, sourceA, sourceB, targetA, targetB) {
  const sourceAngle = Math.atan2(sourceB[1] - sourceA[1], sourceB[0] - sourceA[0]);
  const targetAngle = Math.atan2(targetB[1] - targetA[1], targetB[0] - targetA[0]);
  const angle = targetAngle - sourceAngle;
  const sourceLength = Math.hypot(sourceB[0] - sourceA[0], sourceB[1] - sourceA[1]);
  const targetLength = Math.hypot(targetB[0] - targetA[0], targetB[1] - targetA[1]);
  const factor = sourceLength > EPSILON ? targetLength / sourceLength : 1;
  const cosine = Math.cos(angle) * factor;
  const sine = Math.sin(angle) * factor;

  return polygon.map(([x, y]) => {
    const dx = x - sourceA[0];
    const dy = y - sourceA[1];
    return [targetA[0] + dx * cosine - dy * sine, targetA[1] + dx * sine + dy * cosine];
  });
}

function reflectAcrossLine(polygon, lineA, lineB) {
  const dx = lineB[0] - lineA[0];
  const dy = lineB[1] - lineA[1];
  const denominator = dx * dx + dy * dy;
  if (denominator < EPSILON) return polygon;

  return polygon.map(([x, y]) => {
    const px = x - lineA[0];
    const py = y - lineA[1];
    const projection = (px * dx + py * dy) / denominator;
    const footX = lineA[0] + projection * dx;
    const footY = lineA[1] + projection * dy;
    return [2 * footX - x, 2 * footY - y];
  });
}

function sideOfLine(point, lineA, lineB) {
  return (lineB[0] - lineA[0]) * (point[1] - lineA[1]) -
    (lineB[1] - lineA[1]) * (point[0] - lineA[0]);
}

export function unfoldFaces(vertexPositions) {
  const localShapes = {};
  const placements = {};
  const placementIds = {};
  const hingeKeys = new Set();

  for (const face of FACE_META) {
    const ids = FACE_VERTICES[face.id];
    localShapes[face.id] = flattenFace(vertexPositions, ids);
  }

  for (const step of UNFOLD_TREE) {
    const ids = FACE_VERTICES[step.face];
    const local = localShapes[step.face].polygon;
    if (!step.parent) {
      placements[step.face] = local.map((point) => [...point]);
      placementIds[step.face] = [...ids];
      continue;
    }

    const parentIds = placementIds[step.parent];
    const parentPolygon = placements[step.parent];
    const parentIndex = directedEdgeIndex(parentIds, step.hinge);
    const childIndex = directedEdgeIndex(ids, step.hinge);
    const parentA = parentPolygon[parentIndex];
    const parentB = parentPolygon[(parentIndex + 1) % parentPolygon.length];
    const childA = local[childIndex];
    const childB = local[(childIndex + 1) % local.length];

    let placed = rotateAndPlace(local, childA, childB, parentA, parentB);
    const parentCenter = polygonCentroid2D(parentPolygon);
    const childCenter = polygonCentroid2D(placed);
    const parentSide = sideOfLine(parentCenter, parentA, parentB);
    const childSide = sideOfLine(childCenter, parentA, parentB);

    if (parentSide * childSide > 0) {
      placed = reflectAcrossLine(placed, parentA, parentB);
    }

    const placedIds = [...ids];
    if (polygonArea2D(placed) < 0) {
      placed.reverse();
      placedIds.reverse();
    }
    placements[step.face] = placed;
    placementIds[step.face] = placedIds;
    hingeKeys.add(edgeKey(step.hinge[0], step.hinge[1]));
  }

  return { placements, placementIds, hingeKeys, localShapes };
}

function pointDistance2D(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function pointsEqual(a, b) {
  return pointDistance2D(a, b) < 1e-6;
}

function isPointOnSegment(point, a, b) {
  const crossValue = (b[0] - a[0]) * (point[1] - a[1]) -
    (b[1] - a[1]) * (point[0] - a[0]);
  if (Math.abs(crossValue) > 1e-6) return false;
  return point[0] >= Math.min(a[0], b[0]) - 1e-6 &&
    point[0] <= Math.max(a[0], b[0]) + 1e-6 &&
    point[1] >= Math.min(a[1], b[1]) - 1e-6 &&
    point[1] <= Math.max(a[1], b[1]) + 1e-6;
}

function pointInPolygonStrict(point, polygon) {
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    if (isPointOnSegment(point, a, b)) return false;
  }

  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function sharesEndpoint(a, b, c, d) {
  return pointsEqual(a, c) || pointsEqual(a, d) || pointsEqual(b, c) || pointsEqual(b, d);
}

function segmentsCross(a, b, c, d) {
  if (sharesEndpoint(a, b, c, d)) return false;
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  const crosses = o1 * o2 < -EPSILON && o3 * o4 < -EPSILON;
  if (crosses) return true;

  if (Math.abs(o1) < 1e-6 && isPointOnSegment(c, a, b)) return true;
  if (Math.abs(o2) < 1e-6 && isPointOnSegment(d, a, b)) return true;
  if (Math.abs(o3) < 1e-6 && isPointOnSegment(a, c, d)) return true;
  if (Math.abs(o4) < 1e-6 && isPointOnSegment(b, c, d)) return true;
  return false;
}

export function polygonsOverlap(first, second) {
  for (let aIndex = 0; aIndex < first.length; aIndex += 1) {
    const a = first[aIndex];
    const b = first[(aIndex + 1) % first.length];
    for (let cIndex = 0; cIndex < second.length; cIndex += 1) {
      const c = second[cIndex];
      const d = second[(cIndex + 1) % second.length];
      if (segmentsCross(a, b, c, d)) return true;
    }
  }

  if (first.some((point) => pointInPolygonStrict(point, second))) return true;
  if (second.some((point) => pointInPolygonStrict(point, first))) return true;
  return false;
}

function polygonSelfIntersects(polygon) {
  for (let first = 0; first < polygon.length; first += 1) {
    const firstNext = (first + 1) % polygon.length;
    for (let second = first + 1; second < polygon.length; second += 1) {
      const secondNext = (second + 1) % polygon.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsCross(
        polygon[first],
        polygon[firstNext],
        polygon[second],
        polygon[secondNext],
      )) return true;
    }
  }
  return false;
}

function buildTab(polygon, edgeIndex, faceCenter) {
  const pointA = polygon[edgeIndex];
  const pointB = polygon[(edgeIndex + 1) % polygon.length];
  const edgeLength = pointDistance2D(pointA, pointB);
  if (edgeLength < 0.18) return null;

  const along = [(pointB[0] - pointA[0]) / edgeLength, (pointB[1] - pointA[1]) / edgeLength];
  let outward = [along[1], -along[0]];
  const midpoint = [(pointA[0] + pointB[0]) / 2, (pointA[1] + pointB[1]) / 2];
  const towardCenter = [faceCenter[0] - midpoint[0], faceCenter[1] - midpoint[1]];
  if (outward[0] * towardCenter[0] + outward[1] * towardCenter[1] > 0) {
    outward = [-outward[0], -outward[1]];
  }

  const depth = Math.min(0.34, Math.max(0.22, edgeLength * 0.28));
  const taper = Math.min(depth * 0.42, edgeLength * 0.16);
  const shoulder = 0.83;
  return [
    [...pointA],
    [...pointB],
    [pointB[0] + outward[0] * depth * shoulder - along[0] * taper,
      pointB[1] + outward[1] * depth * shoulder - along[1] * taper],
    [pointA[0] + outward[0] * depth * shoulder + along[0] * taper,
      pointA[1] + outward[1] * depth * shoulder + along[1] * taper],
  ];
}

export function buildNet(vertices) {
  const vertexPositions = Object.fromEntries(
    vertices.map((vertex) => [vertex.id, vertex.position]),
  );
  const { placements, placementIds, hingeKeys } = unfoldFaces(vertexPositions);
  const faces = FACE_META.map((meta) => {
    const polygon = placements[meta.id];
    return {
      ...meta,
      vertexIds: placementIds[meta.id],
      polygon,
      area: polygonArea2D(polygon),
      center: polygonCentroid2D(polygon),
    };
  });

  const candidateTabs = [];
  for (const face of faces) {
    for (let edgeIndex = 0; edgeIndex < face.polygon.length; edgeIndex += 1) {
      const a = face.vertexIds[edgeIndex];
      const b = face.vertexIds[(edgeIndex + 1) % face.vertexIds.length];
      if (hingeKeys.has(edgeKey(a, b))) continue;
      const polygon = buildTab(face.polygon, edgeIndex, face.center);
      if (polygon) {
        candidateTabs.push({
          faceId: face.id,
          edgeIndex,
          edgeKey: edgeKey(a, b),
          base: [face.polygon[edgeIndex], face.polygon[(edgeIndex + 1) % face.polygon.length]],
          polygon,
        });
      }
    }
  }

  const errors = [];
  for (const face of faces) {
    if (!face.polygon.every((point) => point.every(Number.isFinite))) {
      errors.push(`${face.id} 包含无效坐标`);
    } else if (face.area <= 1e-5) {
      errors.push(`${face.id} 面积过小`);
    } else if (polygonSelfIntersects(face.polygon)) {
      errors.push(`${face.id} 边界自交`);
    }
  }

  for (let first = 0; first < faces.length; first += 1) {
    for (let second = first + 1; second < faces.length; second += 1) {
      if (polygonsOverlap(faces[first].polygon, faces[second].polygon)) {
        errors.push(`${faces[first].id} 与 ${faces[second].id} 重叠`);
      }
    }
  }

  const tabs = [];
  const groupedCandidates = new Map();
  for (const candidate of candidateTabs) {
    if (Math.abs(polygonArea2D(candidate.polygon)) <= 1e-5 ||
      polygonSelfIntersects(candidate.polygon)) continue;
    if (!groupedCandidates.has(candidate.edgeKey)) groupedCandidates.set(candidate.edgeKey, []);
    groupedCandidates.get(candidate.edgeKey).push(candidate);
  }

  for (const candidates of groupedCandidates.values()) {
    const available = candidates
      .map((candidate) => {
        const faceCollision = faces.some((face) =>
          face.id !== candidate.faceId && polygonsOverlap(candidate.polygon, face.polygon));
        const tabCollision = tabs.some((tab) => polygonsOverlap(candidate.polygon, tab.polygon));
        return { candidate, blocked: faceCollision || tabCollision };
      })
      .sort((first, second) => Number(first.blocked) - Number(second.blocked));
    if (available.length && !available[0].blocked) tabs.push(available[0].candidate);
  }

  const allPolygons = [...faces.map((face) => face.polygon), ...tabs.map((tab) => tab.polygon)];
  const bounds = polygonBounds(allPolygons);
  const seenPoints = new Map();
  for (const face of faces) {
    face.vertexIds.forEach((id, index) => {
      seenPoints.set(id, { id, position: face.polygon[index] });
    });
  }

  return {
    faces,
    tabs,
    bounds,
    vertexPoints: [...seenPoints.values()].sort((a, b) => a.id - b.id),
    valid: errors.length === 0,
    errors,
  };
}

export function getFaceVertices3D(vertices, faceId) {
  const positions = Object.fromEntries(vertices.map((vertex) => [vertex.id, vertex.position]));
  return FACE_VERTICES[faceId].map((id) => positions[id]);
}
