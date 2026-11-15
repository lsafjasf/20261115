// Narrow-phase contact detection.
//
// Every detector returns null when the shapes are merely close (gap > 0),
// and a Contact when they actually touch/overlap. Contact fields:
//   { a, b, point, normal, depth, gap }
// normal points from body a toward body b; depth >= 0, gap = -depth.
//
// There is no artificial inflation: a strictly positive gap never produces
// a contact, so close-but-disjoint shapes cannot be misreported.

import {
  add,
  clamp,
  closestPointOnSegment,
  dot,
  normalize,
  rotate,
  scale,
  sub,
} from './vec.js';

export const CONTACT_EPS = 1e-6;

const boxAxes = (body) => {
  const u = rotate({ x: 1, y: 0 }, body.angle);
  return [u, { x: -u.y, y: u.x }];
};

// --- circle vs circle -----------------------------------------------------

export function circleCircle(a, b) {
  const ra = a.shape.radius;
  const rb = b.shape.radius;
  const delta = sub(b.pos, a.pos);
  const dist = Math.hypot(delta.x, delta.y);
  const gap = dist - ra - rb;
  if (gap > 0) return null;

  const normal = dist > 1e-12 ? scale(delta, 1 / dist) : { x: 1, y: 0 };
  const point = add(a.pos, scale(normal, ra + Math.max(-gap, 0) / 2));
  return {
    a,
    b,
    point,
    normal,
    depth: Math.max(-gap, 0),
    gap,
  };
}

// --- circle vs OBB --------------------------------------------------------

export function circleBox(circleBody, boxBody) {
  const r = circleBody.shape.radius;
  const local = rotate(sub(circleBody.pos, boxBody.pos), -boxBody.angle);
  const { halfX, halfY } = boxBody.shape;
  const closest = {
    x: clamp(local.x, -halfX, halfX),
    y: clamp(local.y, -halfY, halfY),
  };
  const diff = sub(local, closest);
  const dist = Math.hypot(diff.x, diff.y);

  if (dist > r) return null; // clearly separated (no artificial padding)

  let localNormal;
  let depth;
  if (dist > 1e-9) {
    // Circle center outside the box. diff points box -> circle, so the
    // a -> b (circle -> box) normal is its negation.
    localNormal = scale(diff, -1 / dist);
    depth = r - dist;
  } else {
    // Center inside the box. The nearest wall is on the axis where the
    // center is farthest from the box center (largest |local|), i.e. the
    // smallest remaining clearance to a face. Escape through that wall.
    const faceX = halfX - Math.abs(local.x);
    const faceY = halfY - Math.abs(local.y);
    depth = r + Math.min(faceX, faceY);
    if (faceX < faceY) {
      // Point from circle toward the box interior across the nearest face.
      localNormal = { x: local.x >= 0 ? -1 : 1, y: 0 };
    } else {
      localNormal = { x: 0, y: local.y >= 0 ? -1 : 1 };
    }
  }

  const normal = rotate(localNormal, boxBody.angle);
  const point = add(boxBody.pos, rotate(closest, boxBody.angle));
  return {
    a: circleBody,
    b: boxBody,
    point,
    normal,
    depth: Math.max(depth, 0),
    gap: -Math.max(depth, 0),
  };
}

// --- circle vs wall segment -----------------------------------------------

export function circleWall(circleBody, wallBody) {
  const r = circleBody.shape.radius;
  const [wa, wb] = wallBody.wallPoints();
  const normal = wallBody.wallNormal();
  const closest = closestPointOnSegment(circleBody.pos, wa, wb);
  const delta = sub(circleBody.pos, closest);
  const dist = Math.hypot(delta.x, delta.y);

  if (dist > r) return null;

  let n;
  let depth;
  if (dist > 1e-9) {
    n = scale(delta, 1 / dist);
    depth = r - dist;
  } else {
    // Center lies exactly on the segment: use the wall's own normal.
    n = normal;
    depth = r;
  }

  return {
    a: wallBody,
    b: circleBody,
    point: closest,
    normal: n, // from wall toward circle
    depth: Math.max(depth, 0),
    gap: -Math.max(depth, 0),
  };
}

// --- OBB vs OBB (SAT) -----------------------------------------------------

export function boxBox(a, b) {
  const axesA = boxAxes(a);
  const axesB = boxAxes(b);
  const axes = [axesA[0], axesA[1], axesB[0], axesB[1]];
  const va = a.vertices();
  const vb = b.vertices();

  let minDepth = Infinity;
  let bestAxis = null;
  for (const axis of axes) {
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const v of va) {
      const p = dot(v, axis);
      minA = Math.min(minA, p);
      maxA = Math.max(maxA, p);
    }
    for (const v of vb) {
      const p = dot(v, axis);
      minB = Math.min(minB, p);
      maxB = Math.max(maxB, p);
    }
    const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
    if (overlap <= 0) return null; // separated (or just touching) on this axis
    if (overlap < minDepth) {
      minDepth = overlap;
      bestAxis = axis;
    }
  }

  let normal = bestAxis;
  if (dot(normal, sub(b.pos, a.pos)) < 0) normal = scale(normal, -1);

  // Contact point: deepest vertex of B into A, expressed on A's face plane.
  const refAxes = boxAxes(a);
  const faceSign = dot(normal, refAxes[0]) >= Math.abs(dot(normal, refAxes[1])) ? 0 : 1;
  const faceAxis = refAxes[faceSign];
  const tangent = { x: -faceAxis.y, y: faceAxis.x };
  let deepest = vb[0];
  let bestPen = -Infinity;
  for (const v of vb) {
    const pen = -dot(sub(v, a.pos), normal);
    if (pen > bestPen) {
      bestPen = pen;
      deepest = v;
    }
  }
  // Clamp the deepest vertex onto A's face to keep the point on both shapes.
  const rel = sub(deepest, a.pos);
  const along = dot(rel, faceAxis);
  const half = faceSign === 0 ? a.shape.halfX : a.shape.halfY;
  const point = add(a.pos, add(
    scale(faceAxis, clamp(along, -half, half)),
    scale(tangent, dot(rel, tangent)),
  ));

  return { a, b, point, normal, depth: minDepth, gap: -minDepth };
}

// --- OBB vs wall segment --------------------------------------------------
//
// Two-sided zero-thickness wall. A contact exists when a box vertex crosses
// the wall line (and projects onto the segment), or an endpoint of the wall
// penetrates the box. We keep the deepest such contact.

export function boxWall(boxBody, wallBody) {
  const [wa, wb] = wallBody.wallPoints();
  const wallDir = normalize(sub(wb, wa));
  const normal = { x: -wallDir.y, y: wallDir.x };
  const wallLen = Math.hypot(wb.x - wa.x, wb.y - wa.y);
  const verts = boxBody.vertices();

  let best = null;
  const consider = (point, depth, n) => {
    if (depth <= 0) return;
    // Keep the SHALLOWEST crossing: it is the actual penetration that must be
    // resolved to bring the box back to surface contact.
    if (!best || depth < best.depth) {
      best = {
        a: wallBody,
        b: boxBody,
        point,
        normal: n,
        depth,
        gap: -depth,
      };
    }
  };

  // A zero-thickness wall is two-sided. A contact requires the box to
  // actually straddle the wall line (vertices on BOTH sides), so a box merely
  // resting near either side is never misreported. We measure the penetration
  // of the crossing vertices whose projection lies on the segment.
  const signed = verts.map((v) => dot(sub(v, wa), normal));
  const hasPositive = signed.some((s) => s > 0);
  const hasNegative = signed.some((s) => s < 0);
  if (hasPositive && hasNegative) {
    // Contact normal must point from the wall toward the box center, so use
    // the center's own side of the wall line to fix the normal sign.
    const centerSide = dot(sub(boxBody.pos, wa), normal) >= 0 ? 1 : -1;
    const towardBox = scale(normal, centerSide);
    for (let i = 0; i < verts.length; i++) {
      const v = verts[i];
      const along = dot(sub(v, wa), wallDir);
      if (along < 0 || along > wallLen) continue;
      const s = signed[i];
      // Only the vertices on the opposite side from the center are crossing
      // into the wall; their distance is the penetration to resolve.
      if (Math.sign(s) === centerSide) continue;
      consider(v, Math.abs(s), towardBox);
    }
  }

  // A wall endpoint inside the box (corner hits, edge-on slides).
  for (const endpoint of [wa, wb]) {
    const local = rotate(sub(endpoint, boxBody.pos), -boxBody.angle);
    const { halfX, halfY } = boxBody.shape;
    const ox = halfX - Math.abs(local.x);
    const oy = halfY - Math.abs(local.y);
    if (ox <= 0 || oy <= 0) continue;
    const localPoint = {
      x: clamp(local.x, -halfX, halfX),
      y: clamp(local.y, -halfY, halfY),
    };
    const point = add(boxBody.pos, rotate(localPoint, boxBody.angle));
    const depth = Math.min(ox, oy);
    const outLocal = ox < oy
      ? { x: local.x >= 0 ? 1 : -1, y: 0 }
      : { x: 0, y: local.y >= 0 ? 1 : -1 };
    // outLocal points from box center toward the endpoint (outward); flip it
    // so the contact normal points from the wall into the box interior.
    const inwardN = rotate(scale(outLocal, -1), boxBody.angle);
    consider(point, depth, inwardN);
  }

  return best;
}

// --- dispatcher -----------------------------------------------------------

export function detectContact(a, b) {
  const ka = a.shape.kind;
  const kb = b.shape.kind;
  if (ka === 'circle' && kb === 'circle') return circleCircle(a, b);
  if (ka === 'circle' && kb === 'box') return circleBox(a, b);
  if (ka === 'box' && kb === 'circle') {
    const c = circleBox(b, a);
    return c ? flip(c) : null;
  }
  if (ka === 'circle' && kb === 'wall') {
    const c = circleWall(a, b);
    return c;
  }
  if (ka === 'wall' && kb === 'circle') return circleWall(b, a);
  if (ka === 'box' && kb === 'box') return boxBox(a, b);
  if (ka === 'box' && kb === 'wall') return boxWall(a, b);
  if (ka === 'wall' && kb === 'box') {
    const c = boxWall(b, a);
    return c ? flip(c) : null;
  }
  return null;
}

// Flip so normal still points from the first body toward the second.
function flip(contact) {
  return {
    a: contact.b,
    b: contact.a,
    point: contact.point,
    normal: scale(contact.normal, -1),
    depth: contact.depth,
    gap: contact.gap,
  };
}

// Signed separation gap (< 0 means overlap). Null means "not applicable",
// e.g. disjoint bounding radii; callers then assume a large positive gap.
export function separationGap(a, b) {
  const c = detectContact(a, b);
  return c ? c.gap : Infinity;
}
