// Stable color identity per usage so roofs, floors and pipes keep consistent colors
// while clipping / rotating. Values are hex numbers consumed by THREE.Color.
export const USAGE_TYPES = ['residential', 'office', 'commercial', 'industrial', 'civic'];

export const USAGE_LABELS = {
  residential: '住宅',
  office: '办公',
  commercial: '商业',
  industrial: '工业',
  civic: '公共',
};

export const USAGE_COLORS = {
  residential: 0xe8a87c, // warm terracotta
  office: 0x7fb5d9, // steel blue
  commercial: 0xe3c565, // amber
  industrial: 0x9aa0a6, // concrete grey
  civic: 0xc98bb4, // muted mauve
};

export const MATERIAL_COLORS = {
  ground: 0x6f8f5a,
  groundSide: 0x8a5a3b,
  road: 0x4a4f57,
  foundation: 0x8d8a86,
  basement: 0x6c6a78,
  pipe: 0x2bb6c4, // teal for all underground pipes
  vault: 0x5f7d8c,
  floorSlab: 0xf2ede2,
  roof: 0xb85c4b,
  handleX: 0xe5484d,
  handleY: 0x34a853,
  handleZ: 0x4285f4,
  guide: 0xffe08a,
};

export function buildingColor(usage, shade = 0) {
  const base = USAGE_COLORS[usage] ?? USAGE_COLORS.residential;
  if (shade === 0) return base;
  const r = (base >> 16) & 255;
  const g = (base >> 8) & 255;
  const b = base & 255;
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + shade)));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}
