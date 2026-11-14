export const CANVAS = { width: 1200, height: 720 };

export const SLOT_ORDER = ["center", "third", "fourth"];

export const SLOTS = {
  center: {
    id: "center",
    label: "二轮",
    sublabel: "中心轴",
    target: 48,
    x: 365,
    y: 265,
    meshAngle: 218
  },
  third: {
    id: "third",
    label: "三轮",
    sublabel: "传动轴",
    target: 36,
    x: 426.6,
    y: 353,
    meshAngle: 55
  },
  fourth: {
    id: "fourth",
    label: "四轮",
    sublabel: "秒轴",
    target: 24,
    x: 502.6,
    y: 342.3,
    meshAngle: -8
  }
};

export const GEAR_PARTS = [
  { id: "g20", teeth: 20, kind: "钢轮", finish: "steel" },
  { id: "g24", teeth: 24, kind: "秒轮", finish: "brass" },
  { id: "g30", teeth: 30, kind: "过轮", finish: "brass" },
  { id: "g36", teeth: 36, kind: "三轮", finish: "brass" },
  { id: "g40", teeth: 40, kind: "过轮", finish: "steel" },
  { id: "g42", teeth: 42, kind: "过轮", finish: "brass" },
  { id: "g48", teeth: 48, kind: "二轮", finish: "brass" },
  { id: "g52", teeth: 52, kind: "大钢轮", finish: "steel" },
  { id: "g56", teeth: 56, kind: "大钢轮", finish: "steel" }
];

export const TARGETS = Object.fromEntries(
  SLOT_ORDER.map((slotId) => [slotId, SLOTS[slotId].target])
);

export const MAX_ATTEMPTS = 3;
export const STABLE_SECONDS = 30;

export function radiusForTeeth(teeth) {
  return teeth * 1.29;
}
