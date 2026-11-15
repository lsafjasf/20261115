export const SPEED_OF_SOUND = 343;
export const HEAD_RADIUS = 0.09;
export const SAMPLE_RATE = 48000;
export const IR_DURATION = 1.8;

export const ROOM = Object.freeze({
  width: 10,
  depth: 7,
  height: 3.2,
});

export const SPEAKERS = Object.freeze([
  { id: "P1", name: "左前", short: "FL", x: 0.82, y: 0.82, color: "#65e7e3" },
  { id: "P2", name: "右前", short: "FR", x: 9.18, y: 0.82, color: "#c7f477" },
  { id: "P3", name: "右后", short: "RR", x: 9.18, y: 6.18, color: "#ff9c5d" },
  { id: "P4", name: "左后", short: "RL", x: 0.82, y: 6.18, color: "#c998ff" },
]);

export const MODES = Object.freeze({
  mono: { label: "单源", active: ["P1"] },
  stereo: { label: "双源", active: ["P1", "P2"] },
  quad: { label: "四声道", active: ["P1", "P2", "P3", "P4"] },
});

export const DEFAULT_STATE = Object.freeze({
  mode: "quad",
  absorption: 0.22,
  source: { x: 5, y: 2.2 },
  listener: { x: 5, y: 3.5, yaw: 0 },
});

export const PRESET_MEASUREMENTS = Object.freeze([
  {
    id: "C1",
    label: "左后区",
    source: { x: 5, y: 2.2 },
    listener: { x: 2.15, y: 5.25, yaw: 24 },
  },
  {
    id: "C2",
    label: "中央区",
    source: { x: 5, y: 2.2 },
    listener: { x: 5, y: 3.5, yaw: 88 },
  },
  {
    id: "C3",
    label: "右前区",
    source: { x: 5, y: 2.2 },
    listener: { x: 7.75, y: 2.15, yaw: 146 },
  },
]);

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalizeYaw(yaw) {
  let angle = ((yaw + 180) % 360 + 360) % 360 - 180;
  if (angle === -180) angle = 180;
  return angle;
}

export function yawToRadians(yaw) {
  return (yaw * Math.PI) / 180;
}

export function sanitizeState(state) {
  return {
    ...state,
    source: {
      x: clamp(Number(state.source.x), 0.25, ROOM.width - 0.25),
      y: clamp(Number(state.source.y), 0.25, ROOM.depth - 0.25),
    },
    listener: {
      x: clamp(Number(state.listener.x), 0.3, ROOM.width - 0.3),
      y: clamp(Number(state.listener.y), 0.3, ROOM.depth - 0.3),
      yaw: normalizeYaw(Number(state.listener.yaw) || 0),
    },
    absorption: clamp(Number(state.absorption), 0.08, 0.55),
  };
}

export function getEarPositions(listener) {
  const angle = yawToRadians(listener.yaw);
  const left = {
    x: listener.x + Math.sin(angle) * HEAD_RADIUS,
    y: listener.y - Math.cos(angle) * HEAD_RADIUS,
  };
  const right = {
    x: listener.x - Math.sin(angle) * HEAD_RADIUS,
    y: listener.y + Math.cos(angle) * HEAD_RADIUS,
  };
  const front = {
    x: listener.x + Math.cos(angle),
    y: listener.y + Math.sin(angle),
  };
  return { left, right, front };
}

export function getRoomVolume() {
  return ROOM.width * ROOM.depth * ROOM.height;
}

export function getRoomSurfaceArea() {
  return 2 * (
    ROOM.width * ROOM.depth +
    ROOM.width * ROOM.height +
    ROOM.depth * ROOM.height
  );
}

export function estimateRT60(absorption) {
  return (0.161 * getRoomVolume()) / (getRoomSurfaceArea() * absorption);
}

const WALLS = [
  {
    id: "west",
    label: "西墙",
    reflect: (p) => ({ x: -p.x, y: p.y }),
    value: (p) => p.x,
    target: 0,
  },
  {
    id: "east",
    label: "东墙",
    reflect: (p) => ({ x: 2 * ROOM.width - p.x, y: p.y }),
    value: (p) => p.x,
    target: ROOM.width,
  },
  {
    id: "north",
    label: "北墙",
    reflect: (p) => ({ x: p.x, y: -p.y }),
    value: (p) => p.y,
    target: 0,
  },
  {
    id: "south",
    label: "南墙",
    reflect: (p) => ({ x: p.x, y: 2 * ROOM.depth - p.y }),
    value: (p) => p.y,
    target: ROOM.depth,
  },
];

export function firstOrderReflections(emitter, receiver, absorption, limit = 2) {
  const paths = [];
  for (const wall of WALLS) {
    const image = wall.reflect(emitter);
    const delta = { x: receiver.x - image.x, y: receiver.y - image.y };
    const denominator = wall.value(delta);
    if (Math.abs(denominator) < 1e-8) continue;
    const t = (wall.target - wall.value(image)) / denominator;
    if (t <= 0.001 || t >= 0.999) continue;
    const hit = {
      x: image.x + delta.x * t,
      y: image.y + delta.y * t,
    };
    const pathDistance = Math.hypot(delta.x, delta.y);
    paths.push({
      wallId: wall.id,
      wallLabel: wall.label,
      points: [emitter, hit, receiver],
      hit,
      distance: pathDistance,
      delayMs: (pathDistance / SPEED_OF_SOUND) * 1000,
      reflectionGain: Math.sqrt(1 - absorption),
    });
  }
  return paths.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

export function buildSpatialState(inputState) {
  const state = sanitizeState(inputState);
  const active = new Set(MODES[state.mode]?.active ?? MODES.quad.active);
  const ears = getEarPositions(state.listener);
  const rt60 = estimateRT60(state.absorption);

  const channels = SPEAKERS.map((speaker) => {
    const sourceDistance = distance(state.source, speaker);
    const distanceLeft = distance(speaker, ears.left);
    const distanceRight = distance(speaker, ears.right);
    const nearSide = distanceLeft <= distanceRight ? "left" : "right";
    const nearPoint = ears[nearSide];
    const nearDistance = Math.min(distanceLeft, distanceRight);
    const totalDistance = sourceDistance + nearDistance;
    const reflections = firstOrderReflections(
      speaker,
      nearPoint,
      state.absorption,
      2,
    );
    return {
      ...speaker,
      active: active.has(speaker.id),
      sourceDistance,
      nearSide,
      nearPoint,
      nearDistance,
      totalDistance,
      diagramDelayMs: (totalDistance / SPEED_OF_SOUND) * 1000,
      earDelayMs: {
        left: ((sourceDistance + distanceLeft) / SPEED_OF_SOUND) * 1000,
        right: ((sourceDistance + distanceRight) / SPEED_OF_SOUND) * 1000,
      },
      itdMs: (Math.abs(distanceLeft - distanceRight) / SPEED_OF_SOUND) * 1000,
      reflections,
      sourcePath: {
        points: [state.source, speaker],
        distance: sourceDistance,
      },
      directPath: {
        points: [speaker, nearPoint],
        distance: nearDistance,
      },
    };
  });

  const activeChannels = channels.filter((channel) => channel.active);
  const pathDelays = activeChannels.map((channel) => channel.diagramDelayMs);
  const pathTDOA = pathDelays.length
    ? Math.max(...pathDelays) - Math.min(...pathDelays)
    : 0;
  const pathCount = activeChannels.reduce(
    (count, channel) => count + 1 + channel.reflections.length,
    0,
  );

  return {
    state,
    ears,
    rt60,
    channels,
    activeChannels,
    pathTDOA,
    pathCount,
    activeIds: [...active],
  };
}

export function applyPreset(state, preset) {
  return sanitizeState({
    ...state,
    source: { ...preset.source },
    listener: { ...preset.listener },
  });
}

export function getPresetSpatialState(preset, baseState = DEFAULT_STATE) {
  return buildSpatialState(applyPreset(baseState, preset));
}

export function getOrientationComparison(position, yaws, baseState = DEFAULT_STATE) {
  return yaws.map((yaw) => {
    const state = sanitizeState({
      ...baseState,
      listener: { ...position, yaw },
    });
    const spatial = buildSpatialState(state);
    return {
      yaw,
      predictedTDOA: spatial.pathTDOA,
      channelDelays: spatial.activeChannels.map((channel) => ({
        id: channel.id,
        delayMs: channel.diagramDelayMs,
      })),
    };
  });
}
