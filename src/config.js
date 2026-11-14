export const WORLD = Object.freeze({
  width: 2200,
  height: 1320,
  shoreY: 1200,
});

export const CAMP = Object.freeze({
  x: 270,
  y: 1094,
  radius: 74,
  name: "岸基营地",
});

export const SITES = Object.freeze([
  {
    id: "S-01",
    name: "湖湾脊",
    subtitle: "表层冰 · 陆源沉积",
    x: 590,
    y: 350,
    radius: 48,
    core: "surface",
    hardness: 1,
  },
  {
    id: "S-02",
    name: "蓝冰槽",
    subtitle: "中层冰 · 封闭气泡",
    x: 1170,
    y: 640,
    radius: 48,
    core: "blue",
    hardness: 1.12,
  },
  {
    id: "S-03",
    name: "东岸拱",
    subtitle: "深层冰 · 基岩碎屑",
    x: 1690,
    y: 380,
    radius: 48,
    core: "deep",
    hardness: 1.24,
  },
]);

export const CRACKS = Object.freeze([
  {
    id: "main-lead",
    kind: "open",
    width: 17,
    points: [
      [770, -30],
      [735, 120],
      [760, 300],
      [730, 465],
      [758, 610],
      [744, 760],
      [825, 900],
      [795, 1090],
      [835, 1340],
    ],
  },
  {
    id: "west-ridge",
    kind: "ridge",
    width: 7,
    points: [
      [70, 495],
      [255, 438],
      [420, 506],
      [565, 458],
      [708, 527],
    ],
  },
  {
    id: "blue-lead",
    kind: "open",
    width: 12,
    points: [
      [1010, 55],
      [975, 220],
      [1050, 360],
      [1100, 485],
      [1060, 630],
      [1110, 790],
    ],
  },
  {
    id: "east-lead",
    kind: "open",
    width: 10,
    points: [
      [1435, 52],
      [1495, 230],
      [1570, 390],
      [1645, 545],
      [1785, 650],
      [1910, 790],
    ],
  },
  {
    id: "south-fracture",
    kind: "ridge",
    width: 5,
    points: [
      [910, 1040],
      [1050, 970],
      [1210, 1010],
      [1360, 960],
      [1510, 1015],
    ],
  },
]);

export const BRIDGES = Object.freeze([
  { x: 744, y: 760, radius: 76, rotation: 0.06, label: "A-1" },
  { x: 1050, y: 360, radius: 72, rotation: -0.32, label: "B-2" },
  { x: 1570, y: 390, radius: 72, rotation: -0.25, label: "C-3" },
  { x: 420, y: 506, radius: 70, rotation: 0.24, label: "W-1" },
]);

export const THIN_CRACKS = Object.freeze([
  [
    [160, 870],
    [250, 835],
    [312, 878],
    [385, 840],
  ],
  [
    [890, 445],
    [950, 405],
    [1018, 438],
  ],
  [
    [1290, 160],
    [1360, 132],
    [1415, 180],
  ],
  [
    [1715, 915],
    [1800, 870],
    [1885, 930],
    [1970, 890],
  ],
  [
    [420, 150],
    [480, 185],
    [545, 148],
    [610, 190],
  ],
]);

export const STRATA = Object.freeze({
  surface: {
    label: "表层冰",
    colors: ["#e6fbf5", "#a0dbe2", "#56808f"],
    sample: "陆源尘层",
  },
  blue: {
    label: "中层蓝冰",
    colors: ["#c4f5f2", "#61b8d0", "#285c7b"],
    sample: "封闭气泡",
  },
  deep: {
    label: "深层暗冰",
    colors: ["#8fc8d2", "#3f7084", "#172e42"],
    sample: "基岩碎屑",
  },
});

export const DRILL = Object.freeze({
  maxRpm: 108,
  maxPressure: 82,
  safeRpm: [47, 67],
  safePressure: [30, 54],
  jamRpm: 78,
  torqueJam: 98,
  maxHeat: 100,
  maxTorque: 170,
});

export const COLORS = Object.freeze({
  ice: "#93d6db",
  deepIce: "#194451",
  water: "#061d28",
  cyan: "#7ef3e9",
  mint: "#b8ffda",
  amber: "#ffbd69",
  orange: "#ff815c",
  red: "#ff5b55",
  snow: "#e8f5f1",
});
