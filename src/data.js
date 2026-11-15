(function (root) {
  "use strict";

  const COLORS = {
    mint: "#62efd1",
    cyan: "#5bc9f5",
    amber: "#ffbd62",
    red: "#ff7169",
    pale: "#b6d7b0",
  };

  const CABINS = [
    {
      id: "obs",
      code: "A",
      name: "观测舱",
      english: "OPTICAL BAY",
      pressure: 1.0,
      room: { x: 102, y: 112, w: 278, h: 156 },
      workPoint: { x: 268, y: 190 },
      lock: {
        x: 380,
        y: 166,
        w: 60,
        h: 48,
        outer: { x: 440, y: 190 },
        inner: { x: 380, y: 190 },
      },
    },
    {
      id: "bio",
      code: "B",
      name: "生物舱",
      english: "BIO LAB",
      pressure: 1.0,
      room: { x: 102, y: 332, w: 278, h: 156 },
      workPoint: { x: 268, y: 410 },
      lock: {
        x: 380,
        y: 386,
        w: 60,
        h: 48,
        outer: { x: 440, y: 410 },
        inner: { x: 380, y: 410 },
      },
    },
    {
      id: "cargo",
      code: "C",
      name: "货舱",
      english: "CARGO HOLD",
      pressure: 1.0,
      room: { x: 620, y: 112, w: 278, h: 156 },
      workPoint: { x: 730, y: 190 },
      lock: {
        x: 560,
        y: 166,
        w: 60,
        h: 48,
        outer: { x: 560, y: 190 },
        inner: { x: 620, y: 190 },
      },
    },
    {
      id: "engine",
      code: "D",
      name: "动力舱",
      english: "DRIVE CORE",
      pressure: 1.0,
      room: { x: 620, y: 332, w: 278, h: 156 },
      workPoint: { x: 730, y: 410 },
      lock: {
        x: 560,
        y: 386,
        w: 60,
        h: 48,
        outer: { x: 560, y: 410 },
        inner: { x: 620, y: 410 },
      },
    },
  ];

  const HULL = {
    x: 55,
    y: 62,
    w: 890,
    h: 476,
    cut: 43,
  };

  const HUB = {
    x: 447,
    y: 253,
    w: 106,
    h: 94,
    center: { x: 500, y: 300 },
    dockOne: { x: 481, y: 285 },
    dockTwo: { x: 519, y: 315 },
  };

  const CORRIDOR_PATHS = {
    obs: [
      { x: 500, y: 300 },
      { x: 470, y: 262 },
      { x: 443, y: 216 },
      { x: 440, y: 190 },
    ],
    bio: [
      { x: 500, y: 300 },
      { x: 471, y: 339 },
      { x: 443, y: 384 },
      { x: 440, y: 410 },
    ],
    cargo: [
      { x: 500, y: 300 },
      { x: 530, y: 262 },
      { x: 557, y: 216 },
      { x: 560, y: 190 },
    ],
    engine: [
      { x: 500, y: 300 },
      { x: 529, y: 339 },
      { x: 557, y: 384 },
      { x: 560, y: 410 },
    ],
  };

  const TASKS = [
    {
      id: "A-01",
      cabinId: "obs",
      kind: "inspect",
      kindLabel: "巡检",
      title: "光学阵列巡检",
      detail: "校准主镜姿态与遮光罩驱动",
      duration: 1.65,
      priority: "normal",
      targetPressure: 1.0,
    },
    {
      id: "D-01",
      cabinId: "engine",
      kind: "inspect",
      kindLabel: "巡检",
      title: "推进管束巡检",
      detail: "检查磁约束环与冷却管束",
      duration: 1.75,
      priority: "normal",
      targetPressure: 1.0,
    },
    {
      id: "B-01",
      cabinId: "bio",
      kind: "sample",
      kindLabel: "取样",
      title: "低温菌膜取样",
      detail: "下一班优先占位，样本需冷藏转运",
      duration: 1.9,
      priority: "express",
      targetPressure: 1.0,
    },
    {
      id: "C-01",
      cabinId: "cargo",
      kind: "sample",
      kindLabel: "取样",
      title: "货运封存取样",
      detail: "抽取封存舱空气与表面拭子",
      duration: 1.7,
      priority: "normal",
      targetPressure: 1.0,
    },
    {
      id: "C-02",
      cabinId: "cargo",
      kind: "vent",
      kindLabel: "泄压",
      title: "货舱泄压",
      detail: "关闭内舱门后抽至 0.12 bar",
      duration: 1.55,
      priority: "normal",
      targetPressure: 0.12,
    },
    {
      id: "D-02",
      cabinId: "engine",
      kind: "vent",
      kindLabel: "泄压",
      title: "冷却回路泄压",
      detail: "隔离回路并将动力舱抽至 0.12 bar",
      duration: 1.6,
      priority: "normal",
      targetPressure: 0.12,
    },
  ];

  const DEFAULT_SEQUENCE = ["A-01", "D-01", "B-01", "C-01", "C-02", "D-02"];

  const PHASE_DURATION = {
    travel: 0.9,
    condition: 1.15,
    equalize: 1.0,
    hatch: 0.5,
    enter: 0.45,
    work: 1.65,
    exit: 0.45,
    vent: 1.15,
    restore: 0.8,
    return: 0.8,
  };

  const SPEEDS = [1, 2, 4];
  const STORAGE_KEY = "t09-airlock-sortie-004";
  const LOW_PRESSURE = 0.12;
  const BALANCE_TOLERANCE = 0.015;

  const DATA = {
    COLORS,
    CABINS,
    HULL,
    HUB,
    CORRIDOR_PATHS,
    TASKS,
    DEFAULT_SEQUENCE,
    PHASE_DURATION,
    SPEEDS,
    STORAGE_KEY,
    LOW_PRESSURE,
    BALANCE_TOLERANCE,
    getCabin(id) {
      return CABINS.find((cabin) => cabin.id === id);
    },
    getTask(id) {
      return TASKS.find((task) => task.id === id);
    },
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DATA;
  } else {
    root.TestShipData = DATA;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
