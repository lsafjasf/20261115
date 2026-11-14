export const TARGET_POINTS = [
  [0.0, 0.44],
  [0.035, 0.53],
  [0.12, 0.64],
  [0.28, 0.71],
  [0.44, 0.73],
  [0.56, 0.7],
  [0.64, 0.64],
  [0.71, 0.55],
  [0.78, 0.35],
  [0.85, 0.3],
  [0.92, 0.29],
  [0.965, 0.325],
  [1.0, 0.34],
];

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

export function targetRadius(y) {
  const value = Math.max(0, Math.min(1, y));
  let index = 0;
  while (index < TARGET_POINTS.length - 2 && value > TARGET_POINTS[index + 1][0]) {
    index += 1;
  }

  const p1 = TARGET_POINTS[index];
  const p2 = TARGET_POINTS[index + 1];
  const p0 = TARGET_POINTS[Math.max(0, index - 1)];
  const p3 = TARGET_POINTS[Math.min(TARGET_POINTS.length - 1, index + 2)];
  const span = Math.max(0.0001, p2[0] - p1[0]);
  const t = (value - p1[0]) / span;
  const radius = catmullRom(p0[1], p1[1], p2[1], p3[1], t);
  return Math.max(0.2, radius);
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function gatherRadius(localY) {
  const y = Math.max(0, Math.min(1, localY));
  if (y <= 0.08) return 0.36 + y * 1.4;
  if (y >= 0.92) return Math.max(0.14, 0.28 * (1 - y) / 0.08);
  const belly = Math.sin(Math.PI * Math.pow((y - 0.04) / 0.9, 0.8));
  return 0.38 + belly * 0.18;
}

export function currentProfile(fill, bubbles = []) {
  const f = Math.max(0, Math.min(1.14, (fill - 0.14) / 0.86));
  const height = 0.42 + smoothstep(0.02, 1, f) * 0.58;
  const targetWeight = smoothstep(0.16, 0.94, f);
  const overshoot = Math.max(0, f - 1);
  const points = [];

  for (let i = 0; i <= 68; i += 1) {
    const y = i / 68;
    if (y > height + 0.002) {
      points.push({ y, radius: 0 });
      continue;
    }

    const localY = Math.min(1, y / height);
    const gather = gatherRadius(localY);
    const target = targetRadius(y);
    let radius = gather * (1 - targetWeight) + target * targetWeight;

    for (const bubble of bubbles) {
      const distance = Math.abs(y - bubble.y);
      radius += bubble.size * Math.exp(-(distance * distance) / 0.0024) * 0.32;
    }

    if (overshoot > 0) radius *= 1 + overshoot * 0.22;
    points.push({ y, radius });
  }

  return { points, height, f };
}

export function contourDifference(fill, bubbles = []) {
  const profile = currentProfile(fill, bubbles);
  let squared = 0;
  for (let i = 0; i <= 40; i += 1) {
    const y = i / 40;
    const index = Math.round(y * (profile.points.length - 1));
    const actual = profile.points[index].radius;
    const target = targetRadius(y);
    squared += (actual - target) ** 2;
  }
  return Math.sqrt(squared / 41);
}
