export const WORLD = { width: 1000, height: 700 };
export const DAY_START = 6 * 60;
export const DAY_END = 22 * 60 + 30;
export const SLICE_MINUTES = 30;
export const SLICE_COUNT = (DAY_END - DAY_START) / SLICE_MINUTES;

export const STATIONS = [
  { id: "west-hub", name: "西郊枢纽", code: "A01", x: 105, y: 360, district: "西郊", congestion: 1.2 },
  { id: "creative-park", name: "创意园", code: "A04", x: 190, y: 330, district: "西郊", congestion: 0.8 },
  { id: "univ-town", name: "大学城", code: "B03", x: 265, y: 445, district: "南岸", congestion: 1.8 },
  { id: "riverside", name: "河畔新城", code: "B07", x: 350, y: 365, district: "南岸", congestion: 1.1 },
  { id: "civic-plaza", name: "市民广场", code: "C01", x: 455, y: 300, district: "中心", congestion: 2.5 },
  { id: "old-town", name: "老城中心", code: "C05", x: 525, y: 370, district: "中心", congestion: 2.2 },
  { id: "central-park", name: "中央公园", code: "D02", x: 600, y: 265, district: "中心", congestion: 1.3 },
  { id: "science", name: "科技馆", code: "D06", x: 665, y: 360, district: "东城", congestion: 1.5 },
  { id: "east-station", name: "东站", code: "E01", x: 820, y: 400, district: "东城", congestion: 2.8 },
  { id: "expo", name: "会展中心", code: "E04", x: 845, y: 250, district: "东城", congestion: 1.7 },
  { id: "north-gate", name: "北门", code: "C09", x: 465, y: 150, district: "北城", congestion: 1.4 },
  { id: "stadium", name: "体育馆", code: "C12", x: 585, y: 500, district: "南岸", congestion: 1.6 },
  { id: "south-lake", name: "南湖", code: "D10", x: 710, y: 545, district: "南岸", congestion: 0.9 },
  { id: "binjiang", name: "滨江路", code: "B01", x: 325, y: 205, district: "北城", congestion: 0.7 },
  { id: "finance", name: "金融街", code: "D09", x: 710, y: 195, district: "东城", congestion: 1.9 },
  { id: "west-coach", name: "客运西站", code: "A09", x: 145, y: 165, district: "西郊", congestion: 2.0 },
  { id: "wutong", name: "梧桐里", code: "B12", x: 360, y: 560, district: "南岸", congestion: 0.6 },
  { id: "new-port", name: "新港", code: "E09", x: 900, y: 480, district: "东城", congestion: 1.0 },
];

export const ROUTES = [
  {
    id: "r1", label: "1", name: "1路", color: "#ff7767", headway: 11, phase: 0, baseDelay: 1.1,
    from: "西郊枢纽", to: "东站", stops: ["west-hub", "creative-park", "riverside", "civic-plaza", "central-park", "science", "east-station"],
  },
  {
    id: "r7", label: "7", name: "7路", color: "#ffc857", headway: 14, phase: 4, baseDelay: 1.4,
    from: "北门", to: "南湖", stops: ["north-gate", "riverside", "civic-plaza", "old-town", "stadium", "south-lake"],
  },
  {
    id: "r18", label: "18", name: "18路", color: "#4dd6c1", headway: 12, phase: 7, baseDelay: 1.7,
    from: "客运西站", to: "会展中心", stops: ["west-coach", "binjiang", "univ-town", "riverside", "civic-plaza", "central-park", "finance", "expo"],
  },
  {
    id: "r24", label: "24", name: "24路", color: "#69a7ff", headway: 10, phase: 2, baseDelay: 0.8,
    from: "北门", to: "新港", stops: ["north-gate", "civic-plaza", "old-town", "stadium", "east-station", "new-port"],
  },
  {
    id: "r36", label: "36", name: "36路", color: "#b78cff", headway: 13, phase: 10, baseDelay: 1.2,
    from: "梧桐里", to: "南湖", stops: ["wutong", "univ-town", "riverside", "civic-plaza", "central-park", "science", "south-lake"],
  },
  {
    id: "r52", label: "52", name: "52路", color: "#79df8a", headway: 9, phase: 5, baseDelay: 1.9,
    from: "客运西站", to: "新港", stops: ["west-coach", "binjiang", "north-gate", "civic-plaza", "finance", "expo", "east-station", "new-port"],
  },
];

export const STATION_BY_ID = new Map(STATIONS.map((station) => [station.id, station]));
export const ROUTE_BY_ID = new Map(ROUTES.map((route) => [route.id, route]));

export const DISTRICTS = [
  { name: "西郊片区", points: [[38, 70], [300, 55], [340, 270], [245, 305], [30, 275]] },
  { name: "北城", points: [[315, 35], [590, 30], [610, 210], [500, 255], [300, 230]] },
  { name: "老城", points: [[280, 285], [610, 225], [700, 410], [565, 465], [320, 430]] },
  { name: "东城", points: [[650, 70], [970, 75], [980, 455], [720, 440], [620, 260]] },
  { name: "南岸", points: [[60, 405], [280, 380], [650, 470], [830, 655], [155, 670]] },
];

export const ROAD_LABELS = [
  { text: "西郊快速路", x: 72, y: 305, angle: -0.1 },
  { text: "北环高架", x: 355, y: 65, angle: 0.02 },
  { text: "中央大道", x: 431, y: 585, angle: -1.43 },
  { text: "滨江大道", x: 690, y: 610, angle: -0.58 },
  { text: "东站路", x: 825, y: 525, angle: -1.5 },
];

function mulberry32(seed) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function delayAt(station, minute, route, random) {
  const x = station.x / WORLD.width;
  const morning = 12.8 * Math.exp(-(((minute - 468) / 62) ** 2)) * (0.45 + 0.75 * (1 - x));
  const evening = 14.8 * Math.exp(-(((minute - 1072) / 76) ** 2)) * (0.42 + 0.82 * x);
  const noise = (random() + random() + random() + random() - 2) * 2.2;
  const delay = route.baseDelay + station.congestion + morning + evening + noise;
  return Math.max(0.2, Math.round(delay * 10) / 10);
}

export function generateRawSample() {
  const random = mulberry32(20261112);
  const records = [];
  let rawId = 1;

  for (const route of ROUTES) {
    for (let departure = DAY_START + route.phase; departure < DAY_END; departure += route.headway) {
      const tripId = `${route.id}-${String(departure).padStart(4, "0")}`;
      route.stops.forEach((stopId, stopIndex) => {
        const station = STATION_BY_ID.get(stopId);
        const scheduledMin = departure + stopIndex * 7;
        if (scheduledMin >= DAY_END) return;

        const delayMin = delayAt(station, scheduledMin, route, random);
        const missingArrival = random() < 0.064;
        const missingDelay = random() < 0.046;
        const record = {
          rawId: `X${String(rawId++).padStart(5, "0")}`,
          routeId: route.id,
          stopId,
          tripId,
          scheduledMin,
          actualMin: missingArrival ? null : Math.round((scheduledMin + delayMin) * 10) / 10,
          delayMin: missingDelay ? null : delayMin,
        };
        records.push(record);

        if (random() < 0.058) {
          records.push({
            ...record,
            rawId: `X${String(rawId++).padStart(5, "0")}`,
          });
        }
      });
    }
  }

  return records;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function cleanRawRecords(rawRecords) {
  const seen = new Set();
  const deduplicated = [];
  let removedDuplicates = 0;

  for (const record of rawRecords) {
    const key = `${record.routeId}|${record.tripId}|${record.stopId}`;
    if (seen.has(key)) {
      removedDuplicates += 1;
      continue;
    }
    seen.add(key);
    deduplicated.push(record);
  }

  const delaySamples = new Map();
  const routeSamples = new Map();
  for (const record of deduplicated) {
    const stopKey = `${record.routeId}|${record.stopId}`;
    const samples = delaySamples.get(stopKey) || [];
    if (Number.isFinite(record.delayMin)) {
      samples.push(record.delayMin);
    } else if (Number.isFinite(record.actualMin)) {
      samples.push(record.actualMin - record.scheduledMin);
    }
    delaySamples.set(stopKey, samples);

    const routeValues = routeSamples.get(record.routeId) || [];
    if (Number.isFinite(record.delayMin)) routeValues.push(record.delayMin);
    routeSamples.set(record.routeId, routeValues);
  }

  const stopMedians = new Map(
    [...delaySamples.entries()].map(([key, values]) => [key, median(values)]),
  );
  const routeMedians = new Map(
    [...routeSamples.entries()].map(([key, values]) => [key, median(values)]),
  );

  let filledRecords = 0;
  let filledFields = 0;
  const cleaned = [];

  for (const record of deduplicated) {
    const missingArrival = !Number.isFinite(record.actualMin);
    const missingDelay = !Number.isFinite(record.delayMin);
    if (!missingArrival && !missingDelay) {
      cleaned.push({ ...record, imputed: false });
      continue;
    }

    filledRecords += 1;
    filledFields += Number(missingArrival) + Number(missingDelay);
    let delayMin = record.delayMin;
    let actualMin = record.actualMin;

    if (!Number.isFinite(delayMin)) {
      delayMin = Number.isFinite(actualMin)
        ? actualMin - record.scheduledMin
        : stopMedians.get(`${record.routeId}|${record.stopId}`)
          ?? routeMedians.get(record.routeId)
          ?? 0;
    }
    delayMin = Math.round(delayMin * 10) / 10;
    if (!Number.isFinite(actualMin)) actualMin = Math.round((record.scheduledMin + delayMin) * 10) / 10;

    cleaned.push({ ...record, actualMin, delayMin, imputed: true });
  }

  return {
    records: cleaned,
    report: {
      rawTotal: rawRecords.length,
      removedDuplicates,
      filledRecords,
      filledFields,
      validTotal: cleaned.length,
      qualityRate: cleaned.length / rawRecords.length,
    },
  };
}

export function formatClock(minute, withMinutes = true) {
  const hour = Math.floor(minute / 60) % 24;
  const minutes = Math.round(minute % 60);
  return withMinutes
    ? `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
    : `${String(hour).padStart(2, "0")}:00`;
}

export function getSliceMeta(sliceIndex) {
  const start = DAY_START + sliceIndex * SLICE_MINUTES;
  const end = start + SLICE_MINUTES;
  const period = start < 9 * 60 + 30
    ? "早高峰"
    : start < 16 * 60
      ? "平峰"
      : start < 19 * 60
        ? "晚高峰"
        : "夜间";
  return { index: sliceIndex, start, end, period };
}

export function routesForStation(stationId) {
  return ROUTES.filter((route) => route.stops.includes(stationId));
}

export function recordsInSlice(records, sliceIndex, routeIds = new Set(ROUTES.map((route) => route.id))) {
  const start = DAY_START + sliceIndex * SLICE_MINUTES;
  const end = start + SLICE_MINUTES;
  return records.filter((record) => (
    record.scheduledMin >= start
    && record.scheduledMin < end
    && routeIds.has(record.routeId)
  ));
}

export function buildView(records, sliceIndex, routeIds) {
  const sliceRecords = recordsInSlice(records, sliceIndex, routeIds);
  const stationStats = new Map();
  const routeStats = new Map();
  const arrivals = new Map();

  for (const record of sliceRecords) {
    const stationEntry = stationStats.get(record.stopId) || { delaySum: 0, count: 0, routes: new Set() };
    stationEntry.delaySum += record.delayMin;
    stationEntry.count += 1;
    stationEntry.routes.add(record.routeId);
    stationStats.set(record.stopId, stationEntry);

    const routeEntry = routeStats.get(record.routeId) || { delaySum: 0, count: 0 };
    routeEntry.delaySum += record.delayMin;
    routeEntry.count += 1;
    routeStats.set(record.routeId, routeEntry);

    const arrivalKey = `${record.routeId}|${record.stopId}`;
    const list = arrivals.get(arrivalKey) || [];
    list.push(record.scheduledMin);
    arrivals.set(arrivalKey, list);
  }

  const gaps = [];
  for (const times of arrivals.values()) {
    times.sort((a, b) => a - b);
    for (let index = 1; index < times.length; index += 1) {
      const gap = times[index] - times[index - 1];
      if (gap > 0 && gap <= 45) gaps.push(gap);
    }
  }

  const averageDelay = sliceRecords.length
    ? sliceRecords.reduce((sum, record) => sum + record.delayMin, 0) / sliceRecords.length
    : 0;
  const onTimeRate = sliceRecords.length
    ? sliceRecords.filter((record) => record.delayMin <= 3).length / sliceRecords.length
    : 0;
  const highDelayStations = [...stationStats.entries()]
    .map(([stopId, entry]) => ({ stopId, avgDelay: entry.delaySum / entry.count, count: entry.count }))
    .filter((entry) => entry.avgDelay >= 8)
    .sort((a, b) => b.avgDelay - a.avgDelay);

  return {
    records: sliceRecords,
    stationStats,
    routeStats,
    averageDelay,
    onTimeRate,
    averageHeadway: gaps.length ? median(gaps) : 0,
    headwaySamples: gaps,
    highDelayStations,
    recordCount: sliceRecords.length,
  };
}

export function buildTimeline(records, routeIds) {
  return Array.from({ length: SLICE_COUNT }, (_, sliceIndex) => {
    const view = buildView(records, sliceIndex, routeIds);
    return { sliceIndex, averageDelay: view.averageDelay, recordCount: view.recordCount };
  });
}
