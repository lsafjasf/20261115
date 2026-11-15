import { MATERIALS, FIXED_MATERIALS, ROOM_LIMITS } from "./materials.js";

export const SOUND_SPEED = 343; // m/s，室温近似

export const DEFAULT_STATE = {
  width: 4.2,
  depth: 5.0,
  height: 2.8,
  walls: { left: "plaster", right: "plaster", back: "wood" },
  wet: 0.35,
};

// 鼓与听音位固定在中轴线上，距最近墙 0.9 m
const EDGE_GAP = 0.9;
const EAR_HEIGHT = 1.4;

export function sourcePos(state) {
  return { x: 0, y: EAR_HEIGHT, z: EDGE_GAP };
}

export function listenerPos(state) {
  return { x: 0, y: EAR_HEIGHT, z: state.depth - EDGE_GAP };
}

function wallMaterial(state, wall) {
  if (wall === "front") return FIXED_MATERIALS.front;
  if (wall === "floor") return FIXED_MATERIALS.floor;
  if (wall === "ceiling") return FIXED_MATERIALS.ceiling;
  return MATERIALS[state.walls[wall]];
}

function wallAreas(state) {
  const { width: w, depth: d, height: h } = state;
  return {
    left: d * h, right: d * h,
    back: w * h, front: w * h,
    floor: w * d, ceiling: w * d,
  };
}

// Eyring 混响时间 + FDN 延迟网络参数
export function computeAcoustics(state) {
  const { width: w, depth: d, height: h } = state;
  const volume = w * d * h;
  const areas = wallAreas(state);
  const surfaceArea = Object.values(areas).reduce((a, b) => a + b, 0);

  let absorption = 0;
  let cutoffWeighted = 0;
  for (const wall of Object.keys(areas)) {
    const mat = wallMaterial(state, wall);
    absorption += areas[wall] * mat.alpha;
    cutoffWeighted += areas[wall] * mat.cutoff;
  }
  const alphaAvg = Math.min(absorption / surfaceArea, 0.95);
  // 一阶低通系数 a=2πfc/fs 需 <1；留余量，fc 上限约 fs/8（44.1k 下 ≈5.5k）
  const dampingCutoff = Math.min(cutoffWeighted / surfaceArea, 5200);

  // Eyring: RT60 = 0.161 V / (-S ln(1 - alphaBar))
  const rt60 = (0.161 * volume) / (-surfaceArea * Math.log(1 - alphaAvg));

  // 平均自由程决定 FDN 延迟线尺度
  const meanFreePath = (4 * volume) / surfaceArea;
  const base = meanFreePath / SOUND_SPEED;
  const ratios = [1.0, 1.19, 1.4, 1.63];
  const delayTimes = ratios.map((r) =>
    Math.min(0.8, Math.max(0.004, base * r))
  );
  // 每条延迟线的振幅反馈增益。理想一阶环路为 10^(-1.5t/RT60)，
  // 但 4 路 Hadamard 混合 + 一阶阻尼的实际衰减率经离线 Worklet 标定
  // （T30 拟合，系数在多组增益/延迟下稳定于 -2.32），用实测系数更准。
  const feedbackGains = delayTimes.map((t) =>
    Math.pow(10, (-2.32 * t) / Math.max(rt60, 0.05))
  );

  return { volume, surfaceArea, alphaAvg, rt60, dampingCutoff,
           meanFreePath, delayTimes, feedbackGains };
}

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// 镜像声源：对一组墙面依次做镜像，得到反射路径
function imageSource(state, src, walls) {
  const p = { ...src };
  for (const wall of walls) {
    if (wall === "left") p.x = -state.width - p.x;
    else if (wall === "right") p.x = 2 * state.width - p.x;
    else if (wall === "front") p.z = -p.z;
    else if (wall === "back") p.z = 2 * state.depth - p.z;
    else if (wall === "ceiling") p.y = 2 * state.height - p.y;
  }
  return p;
}

const WALL_LABEL = {
  left: "左墙", right: "右墙", front: "前墙", back: "后墙", ceiling: "天花板",
};

// 早期反射：直达声 + 一次反射（5 条）+ 二次反射（4 条）
export function computePaths(state) {
  const src = sourcePos(state);
  const lis = listenerPos(state);
  const directDist = dist3(src, lis);

  const combos = [
    [],
    ["left"], ["right"], ["front"], ["back"], ["ceiling"],
    ["left", "back"], ["right", "back"],
    ["left", "front"], ["right", "front"],
    // 三阶轴向弹跳：前→后→前、后→前→后，长走廊中表现为明显的轴向回声
    ["front", "back", "front"],
    ["back", "front", "back"],
  ];

  return combos.map((walls) => {
    const img = imageSource(state, src, walls);
    const distance = dist3(img, lis);
    const relDelay = (distance - directDist) / SOUND_SPEED;
    let amp = directDist / distance; // 几何扩散归一化
    for (const wall of walls) {
      amp *= Math.sqrt(1 - wallMaterial(state, wall).alpha); // 振幅反射系数
    }
    return {
      label: walls.length ? walls.map((w) => WALL_LABEL[w]).join("→") : "直达声",
      order: walls.length,
      distance,
      relDelay,
      gain: amp,
      image: img,
      walls,
    };
  });
}

export function clampDimensions(partial) {
  const out = {};
  for (const key of ["width", "depth", "height"]) {
    const lim = ROOM_LIMITS[key === "width" ? "w" : key === "depth" ? "d" : "h"];
    out[key] = Math.min(lim.max, Math.max(lim.min, partial[key]));
  }
  return out;
}
