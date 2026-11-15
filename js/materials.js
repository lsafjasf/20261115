// 墙面材质库：alpha 为随机入射吸声系数（中频段近似值），
// cutoff 为该材质对高频的等效低通截止频率（Hz）。
export const MATERIALS = {
  concrete: { id: "concrete", name: "混凝土", alpha: 0.04, cutoff: 8000, color: "#9aa4b2" },
  plaster:  { id: "plaster",  name: "抹灰砖墙", alpha: 0.08, cutoff: 6500, color: "#c8c2b4" },
  wood:     { id: "wood",     name: "木质吸音", alpha: 0.18, cutoff: 3200, color: "#b07d4f" },
  acoustic: { id: "acoustic", name: "吸音棉板", alpha: 0.55, cutoff: 1100, color: "#6fbf8f" },
  heavyCurtain: { id: "heavyCurtain", name: "厚窗帘", alpha: 0.7, cutoff: 700, color: "#7d6bb0" },
};

export const MATERIAL_IDS = Object.keys(MATERIALS);

// 不可拖动的固定面
export const FIXED_MATERIALS = {
  front: MATERIALS.concrete,   // 前墙（z=0，鼓后方）
  floor: MATERIALS.concrete,   // 地板
  ceiling: MATERIALS.plaster,  // 天花板
};

export const ROOM_LIMITS = {
  w: { min: 2.5, max: 8 },
  d: { min: 2.5, max: 24 },
  h: { min: 2.2, max: 6 },
};
