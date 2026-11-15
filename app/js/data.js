import { makePath } from "./util.js";

const START_CLOCK = 8 * 3600;

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildRoute(cfg) {
  const path = makePath(cfg.waypoints);
  const stations = cfg.stations.map((st) => ({ ...st, dwell: 0, passed: false }));
  const totalMeters = cfg.lengthM;
  const rnd = mulberry32(cfg.seed);
  const samples = [];
  let progress = 0;
  let dwellIdx = -1;
  let dwellLeft = 0;
  let launchM = 0;
  let t = 0;

  const armedWindows = [];
  const firedRangeEvents = new Set();
  function eventAt(time, curProgress) {
    for (const e of cfg.events) {
      if (e.type === "skip") continue;
      if (
        e.sRange &&
        !firedRangeEvents.has(e) &&
        curProgress >= e.sRange[0]
      ) {
        firedRangeEvents.add(e);
        armedWindows.push({
          type: e.type,
          start: time,
          end: time + e.duration,
        });
      }
      if (e.afterStation) {
        const st = stations.find((x) => x.id === e.afterStation);
        if (
          !firedRangeEvents.has(e) &&
          st.departure !== undefined &&
          time >= st.departure + e.offsetSec
        ) {
          firedRangeEvents.add(e);
          armedWindows.push({
            type: e.type,
            start: time,
            end: time + e.duration,
            speedLimit: e.type === "overspeed" ? cfg.speedLimit : undefined,
          });
        }
      }
    }
    return armedWindows.find((w) => time >= w.start && time < w.end) || null;
  }

  const firstStation = stations.find((st) => st.s === 0);
  if (firstStation) {
    firstStation.passed = true;
    firstStation.dwell = firstStation.dwellSec;
    firstStation.arrival = 0;
    dwellIdx = stations.indexOf(firstStation);
    dwellLeft = firstStation.dwellSec;
  }

  while (progress < 1 && t < 7200) {
    const ev = eventAt(t, progress);
    const baseKmh = cfg.baseSpeed * (0.9 + rnd() * 0.2);
    let vKmh = baseKmh;
    let injected = null;

    if (ev && ev.type === "overspeed" && dwellIdx < 0) {
      vKmh = cfg.speedLimit + 12 + rnd() * 8;
      injected = ev;
    }
    if (ev && ev.type === "reverse" && dwellIdx < 0) {
      vKmh = 18 + rnd() * 6;
      injected = ev;
    }

    const nextStation = stations.find((st) => !st.passed && progress <= st.s);
    if (nextStation && !(injected && injected.type === "overspeed")) {
      const gapM = (nextStation.s - progress) * totalMeters;
      if (gapM < 260) {
        vKmh = Math.min(vKmh, 9 + (gapM / 260) * (baseKmh - 9));
      }
    }

    if (dwellIdx >= 0) {
      dwellLeft -= 1;
      vKmh = 0;
      if (dwellLeft <= 0) {
        stations[dwellIdx].departure = t;
        dwellIdx = -1;
        launchM = 140;
      }
    }
    if (launchM > 0 && dwellIdx < 0) {
      const covered = 140 - launchM;
      const launchCap = 8 + (covered / 140) * (baseKmh - 8);
      if (!(injected && injected.type === "overspeed")) vKmh = Math.min(vKmh, launchCap);
      launchM = Math.max(0, launchM - Math.max(0, vKmh) / 3.6);
    }

    let signed = vKmh;
    let dS = (vKmh / 3.6) / totalMeters;
    if (injected && injected.type === "reverse") {
      signed = -vKmh;
      dS = -dS;
    }

    progress = Math.max(0, Math.min(1, progress + dS));

    const skipCfg = cfg.events.find(
      (e) => e.type === "skip" && e.station === nextStation?.id
    );
    if (nextStation && progress >= nextStation.s) {
      if (skipCfg) {
        nextStation.passed = true;
      } else if (dwellIdx < 0) {
        dwellIdx = stations.indexOf(nextStation);
        dwellLeft = nextStation.dwellSec;
        nextStation.dwell = nextStation.dwellSec;
        nextStation.arrival = t;
        nextStation.passed = true;
        progress = nextStation.s;
        signed = 0;
      }
    }

    const [x, y] = path.pointAt(progress);
    samples.push({
      t,
      clock: START_CLOCK + t,
      s: progress,
      x,
      y,
      speed: Math.round(signed * 10) / 10,
    });

    t += 1;
  }

  const anomalies = detectAnomalies(samples, stations, cfg.speedLimit);
  return {
    id: cfg.id,
    name: cfg.name,
    path,
    stations,
    samples,
    anomalies,
    speedLimit: cfg.speedLimit,
    duration: samples.length,
  };
}

function detectAnomalies(samples, stations, speedLimit) {
  const out = [];
  let run = null;
  const flush = () => {
    if (run) {
      run.peak = Math.round(run.peak * 10) / 10;
      out.push(run);
      run = null;
    }
  };
  for (const p of samples) {
    const kind = p.speed > speedLimit ? "speed" : p.speed < -1 ? "reverse" : null;
    if (kind) {
      if (run && run.type === kind && run.end === p.t) {
        run.end = p.t + 1;
        run.peak = kind === "speed" ? Math.max(run.peak, p.speed) : Math.min(run.peak, p.speed);
      } else {
        flush();
        run = { type: kind, start: p.t, end: p.t + 1, peak: p.speed, speedLimit };
      }
    } else {
      flush();
    }
  }
  flush();
  for (const st of stations) {
    if (!st.dwell || st.dwell === 0) {
      const near = samples.reduce((best, p) =>
        Math.abs(p.s - st.s) < Math.abs(best.s - st.s) ? p : best);
      out.push({
        type: "skip",
        start: near.t,
        end: near.t,
        stationId: st.id,
        stationName: st.name,
      });
    }
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

export const ROUTES = [
  buildRoute({
    id: "R1",
    name: "12路 · 城东环线（异常演示线）",
    seed: 12,
    baseSpeed: 34,
    speedLimit: 50,
    lengthM: 9600,
    waypoints: [
      [60, 420], [180, 420], [260, 360], [360, 300], [520, 300],
      [600, 240], [660, 140], [820, 120], [900, 200], [880, 330],
      [780, 400], [620, 430], [520, 500], [360, 520], [200, 520], [100, 560],
    ],
    stations: [
      { id: "S1", name: "城东枢纽", s: 0.0, dwellSec: 20 },
      { id: "S2", name: "滨河公园", s: 0.14, dwellSec: 14 },
      { id: "S3", name: "市立医院", s: 0.29, dwellSec: 16 },
      { id: "S4", name: "中央广场", s: 0.44, dwellSec: 18 },
      { id: "S5", name: "科技园南门", s: 0.6, dwellSec: 15 },
      { id: "S6", name: "西湖校区", s: 0.76, dwellSec: 14 },
      { id: "S7", name: "老街口", s: 0.89, dwellSec: 16 },
      { id: "S8", name: "火车西站", s: 1.0, dwellSec: 20 },
    ],
    events: [
      { type: "overspeed", afterStation: "S2", offsetSec: 4, duration: 22 },
      { type: "skip", station: "S4" },
      { type: "reverse", sRange: [0.56, 0.585], duration: 18 },
      { type: "overspeed", afterStation: "S5", offsetSec: 6, duration: 16 },
    ],
  }),
  buildRoute({
    id: "R2",
    name: "7路 · 滨江快线",
    seed: 7,
    baseSpeed: 38,
    speedLimit: 60,
    lengthM: 11800,
    waypoints: [
      [80, 120], [240, 150], [420, 140], [560, 200], [720, 190],
      [880, 260], [920, 420], [820, 520], [620, 540], [420, 500],
      [240, 540], [100, 500],
    ],
    stations: [
      { id: "S1", name: "滨江码头", s: 0.0, dwellSec: 18 },
      { id: "S2", name: "会展中心", s: 0.2, dwellSec: 14 },
      { id: "S3", name: "金融城", s: 0.42, dwellSec: 16 },
      { id: "S4", name: "体育中心", s: 0.63, dwellSec: 15 },
      { id: "S5", name: "湿地公园", s: 0.82, dwellSec: 14 },
      { id: "S6", name: "南站枢纽", s: 1.0, dwellSec: 22 },
    ],
    events: [
      { type: "overspeed", afterStation: "S2", offsetSec: 10, duration: 18 },
      { type: "reverse", sRange: [0.5, 0.52], duration: 14 },
    ],
  }),
  buildRoute({
    id: "R3",
    name: "21路 · 山麓通勤线",
    seed: 21,
    baseSpeed: 30,
    speedLimit: 40,
    lengthM: 8400,
    waypoints: [
      [120, 520], [200, 420], [180, 300], [280, 220], [420, 180],
      [560, 120], [700, 160], [820, 120], [900, 240], [840, 380],
      [700, 460], [560, 520],
    ],
    stations: [
      { id: "S1", name: "山麓北站", s: 0.0, dwellSec: 16 },
      { id: "S2", name: "云台寺", s: 0.18, dwellSec: 14 },
      { id: "S3", name: "松涛山庄", s: 0.38, dwellSec: 12 },
      { id: "S4", name: "观景台", s: 0.58, dwellSec: 15 },
      { id: "S5", name: "银杏大道", s: 0.78, dwellSec: 14 },
      { id: "S6", name: "湖畔终点", s: 1.0, dwellSec: 18 },
    ],
    events: [
      { type: "skip", station: "S3" },
      { type: "overspeed", afterStation: "S4", offsetSec: 8, duration: 18 },
      { type: "skip", station: "S5" },
    ],
  }),
];

export { START_CLOCK };
