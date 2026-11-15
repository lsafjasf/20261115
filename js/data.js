// 齿轮系数据模型：模数 m=4(px)，节圆半径 r = m*N/2
// 传动链：擒纵轮 -> 四轮(秒) -> 三轮 -> 中心轮(分) -> 跨轮 -> 时轮
export const MODULE = 4;

export const LAYER = { GEAR: 'gear', ESC: 'escapement', DIAL: 'dial' };

// 每个零件可含 wheel(大齿盘) 与 pinion(同轴小齿轴)，两者刚性同速
export const GEARS = [
  {
    id: 'center', name: '中心轮（分针轮）', layer: LAYER.GEAR,
    x: 0, y: 0, wheel: 64, pinion: 15, // pinion 为炮轮(cannon)，驱动跨轮
    hand: 'minute',
  },
  {
    id: 'third', name: '三轮', layer: LAYER.GEAR,
    x: -135.3, y: -49.2, wheel: 64, pinion: 8, // 故障件：正确轮片应为 60 齿
  },
  {
    id: 'fourth', name: '四轮（秒针轮）', layer: LAYER.GEAR,
    x: -253.1, y: 18.8, wheel: 64, pinion: 8,
    hand: 'second',
  },
  {
    id: 'escapePinion', name: '擒纵轮轴齿', layer: LAYER.GEAR,
    x: -278.1, y: 160.6, wheel: 0, pinion: 8, // 与擒纵轮同轴
    rigid: 'escape',
  },
  {
    id: 'minute', name: '跨轮', layer: LAYER.GEAR,
    x: 68.8, y: 98.3, wheel: 45, pinion: 12,
  },
  {
    id: 'hour', name: '时轮', layer: LAYER.GEAR,
    x: 0, y: 0, wheel: 48, pinion: 0,
    hand: 'hour',
  },
  {
    id: 'escape', name: '擒纵轮', layer: LAYER.ESC,
    x: -278.1, y: 160.6, wheel: 30, pinion: 0,
  },
];

// 啮合关系：[零件A, A用轮片还是轴齿, 零件B, B用轮片还是轴齿]
export const MESHES = [
  { a: 'center', pa: 'wheel', b: 'third', pb: 'pinion' },
  { a: 'third', pa: 'wheel', b: 'fourth', pb: 'pinion' },
  { a: 'fourth', pa: 'wheel', b: 'escapePinion', pb: 'pinion' },
  { a: 'center', pa: 'pinion', b: 'minute', pb: 'wheel' },
  { a: 'minute', pa: 'pinion', b: 'hour', pb: 'wheel' },
];

// 零件库：三轮的替换件（只有 60T 能闭合所有连接）
export const PARTS_BIN = [
  { id: 'third-56', target: 'third', teeth: 56, label: '三轮轮片 56T' },
  { id: 'third-60', target: 'third', teeth: 60, label: '三轮轮片 60T（原厂）' },
  { id: 'third-64', target: 'third', teeth: 64, label: '三轮轮片 64T' },
];

export const CORRECT_TEETH = { third: 60 };

// 擒纵机构几何（相对擒纵轮中心）
export const ESCAPEMENT = {
  anchorPivot: { dx: 0, dy: -150 }, // 擒纵叉支点
  anchorSpan: 120,                  // 左右擒纵叉瓦间距
  pendulumLen: 250,
  beatPeriod: 0.25,                 // 秒/拍（摆周期 0.5s，每周期 2 拍，共 4 拍/秒）
  amplitude: 0.16,                  // 摆幅 rad
};

// 表盘（独立面板区域，位于齿轮系右侧）
export const DIAL = { cx: 360, cy: 10, radius: 150, secondCx: 360, secondCy: 75, secondR: 42 };

// 主发条扭矩（N·mm），沿传动链按齿比放大/衰减，效率 0.97/级
export const BARREL_TORQUE = 500;
export const MESH_EFFICIENCY = 0.97;

export function pitchRadius(teeth) {
  return (MODULE * teeth) / 2;
}

export function gearById(id) {
  return GEARS.find((g) => g.id === id);
}

export function meshTeeth(mesh, side) {
  const g = gearById(side === 'a' ? mesh.a : mesh.b);
  const part = (side === 'a' ? mesh.pa : mesh.pb);
  return part === 'wheel' ? g.wheel : g.pinion;
}

export function meshCenterDist(mesh) {
  const ga = gearById(mesh.a);
  const gb = gearById(mesh.b);
  return Math.hypot(ga.x - gb.x, ga.y - gb.y);
}
