import {
  DEFAULT_ROOM, DEFAULT_LISTENER, buildPath, positionAt,
  sabineRT60, isInsideRoom, v3, inverseDistanceGain,
  stereoPan, equalPowerGains, clamp,
} from './acoustics.js';

export const PATH_PRESETS = {
  // 默认路径两端故意超出房间边界（x 从 -4.2 到 +4.2，半宽仅 3）。
  crossing: {
    label: '穿越边界大对角',
    points: [[-4.2, 1.5, -3.6], [0, 1.5, 0], [4.2, 1.5, 3.6]],
  },
  sweep: {
    label: '横向扫过监听点',
    points: [[-4.5, 1.5, 0], [4.5, 1.5, 0]],
  },
  loop: {
    label: '室内高度起伏环',
    points: [[-2.2, 0.6, -1.8], [2.2, 2.4, -1.8], [2.2, 0.6, 1.8], [-2.2, 2.4, 1.8]],
  },
};

export function createState() {
  const preset = PATH_PRESETS.crossing;
  const state = {
    room: { ...DEFAULT_ROOM },
    listener: {
      position: [...DEFAULT_LISTENER.position],
      forward: [...DEFAULT_LISTENER.forward],
    },
    pathPoints: preset.points.map((p) => [...p]),
    speed: 1.2,
    pingpong: true,
    mode: 'binaural',
    sourceType: 'sine',
    wetMix: 0.35,
    u: 0,
    direction: 1,
    playing: false,
  };
  state.path = buildPath(state.pathPoints);
  state.sourcePos = positionAt(state.path, 0);
  return state;
}

export function currentMetrics(state) {
  const distance = v3.dist(state.sourcePos, state.listener.position);
  const gain = inverseDistanceGain(distance);
  const pan = stereoPan(state.sourcePos, state.listener, state.listener.forward);
  const gains = equalPowerGains(pan);
  return {
    distance,
    gain,
    pan,
    leftGain: gain * gains.left,
    rightGain: gain * gains.right,
    rt60: sabineRT60(state.room),
    inside: isInsideRoom(state.sourcePos, state.room),
  };
}

// 推进声源位置，返回本帧是否经过边界（进入或穿出房间）。
export function advanceSource(state, deltaSeconds) {
  if (!state.playing) return false;
  const before = isInsideRoom(state.sourcePos, state.room);
  const du = (state.speed * deltaSeconds) / Math.max(state.path.length, 0.001);
  state.u += state.direction * du;
  if (state.u >= 1) {
    state.u = state.pingpong ? 1 : 0;
    if (state.pingpong) state.direction = -1;
  } else if (state.u <= 0) {
    state.u = 0;
    state.direction = 1;
  }
  state.sourcePos = positionAt(state.path, state.u);
  return before !== isInsideRoom(state.sourcePos, state.room);
}

export function rebuildPath(state) {
  state.path = buildPath(state.pathPoints);
  state.u = clamp(state.u, 0, 1);
  state.sourcePos = positionAt(state.path, state.u);
}

// 几何仿真自检：不依赖音频设备，沿横向扫描验证方向与衰减。
export function simulateSweep(state) {
  const sweepY = Math.min(state.listener.position[1], state.room.height - 0.1);
  const sweepZ = clamp(state.listener.position[2], -state.room.depth / 2 + 0.1, state.room.depth / 2 - 0.1);
  const points = [
    [-state.room.width / 2 - 1.2, sweepY, sweepZ],
    [state.room.width / 2 + 1.2, sweepY, sweepZ],
  ];
  const path = buildPath(points);
  const rows = [];
  for (let i = 0; i <= 48; i++) {
    const pos = positionAt(path, i / 48);
    const distance = v3.dist(pos, state.listener.position);
    const gain = inverseDistanceGain(distance);
    const pan = stereoPan(pos, state.listener, state.listener.forward);
    const g = equalPowerGains(pan);
    rows.push({
      x: pos[0], distance, gain, pan,
      left: gain * g.left, right: gain * g.right,
      inside: isInsideRoom(pos, state.room),
    });
  }
  return checkSweep(rows);
}

function checkSweep(rows) {
  const leftSide = rows.filter((r) => r.x < -0.5);
  const rightSide = rows.filter((r) => r.x > 0.5);
  const panCorrect = leftSide.every((r) => r.pan < -0.5) && rightSide.every((r) => r.pan > 0.5);
  const leftChannel = leftSide.every((r) => r.left > r.right);
  const rightChannel = rightSide.every((r) => r.right > r.left);
  const nearest = rows.reduce((a, b) => (b.distance < a.distance ? b : a), rows[0]);
  const attenuation = rows.every((r) => r.gain <= 1.0000001)
    && nearest.gain >= 0.999
    && rows[0].gain < rows[Math.floor(rows.length / 2)].gain;
  const crossed = rows[0].inside === false
    && rows[rows.length - 1].inside === false
    && rows.some((r) => r.inside);
  return {
    rows,
    checks: [
      { name: '扫描线穿越房间边界（内→外）', pass: crossed },
      { name: '左侧 pan<0、右侧 pan>0，方向一致', pass: panCorrect },
      { name: '左/右声道增益跟随声像反转', pass: leftChannel && rightChannel },
      { name: '距离越近增益越大，且增益 ≤ 0dB', pass: attenuation },
    ],
  };
}

const STORE_KEY = 'room-acoustics-scenes-v1';

export function listSavedScenes() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveScene(name, state) {
  const all = listSavedScenes();
  all[name] = exportScene(name, state);
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
}

export function deleteScene(name) {
  const all = listSavedScenes();
  delete all[name];
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
}

export function exportScene(name, state) {
  return {
    version: 1,
    name,
    savedAt: new Date().toISOString(),
    room: { ...state.room },
    listener: {
      position: [...state.listener.position],
      forward: [...state.listener.forward],
    },
    pathPoints: state.pathPoints.map((p) => [...p]),
    speed: state.speed,
    pingpong: state.pingpong,
    mode: state.mode,
    sourceType: state.sourceType,
    wetMix: state.wetMix,
    rt60: sabineRT60(state.room),
  };
}

export function applyScene(state, scene) {
  state.room = { ...scene.room };
  state.listener = {
    position: [...scene.listener.position],
    forward: [...scene.listener.forward],
  };
  state.pathPoints = scene.pathPoints.map((p) => [...p]);
  state.speed = scene.speed ?? state.speed;
  state.pingpong = scene.pingpong ?? state.pingpong;
  state.mode = scene.mode ?? state.mode;
  state.sourceType = scene.sourceType ?? state.sourceType;
  state.wetMix = scene.wetMix ?? state.wetMix;
  state.u = 0;
  state.direction = 1;
  rebuildPath(state);
}
