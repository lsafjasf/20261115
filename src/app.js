import {
  DAY_START,
  DISTRICTS,
  ROAD_LABELS,
  ROUTES,
  ROUTE_BY_ID,
  SLICE_COUNT,
  STATIONS,
  STATION_BY_ID,
  WORLD,
  buildTimeline,
  buildView,
  cleanRawRecords,
  formatClock,
  generateRawSample,
  getSliceMeta,
  routesForStation,
} from "./core.js";

const rawRecords = generateRawSample();
const cleaned = cleanRawRecords(rawRecords);
const records = cleaned.records;
const allRouteIds = new Set(ROUTES.map((route) => route.id));

const state = {
  sliceIndex: 5,
  routeIds: new Set(allRouteIds),
  selectedStationId: null,
  directRouteId: null,
  hoverStationId: null,
  focusStationIndex: 0,
  playing: false,
};

const dom = {
  routeList: document.querySelector("#routeList"),
  routeCount: document.querySelector("#routeCount"),
  allRoutes: document.querySelector("#allRoutes"),
  resetView: document.querySelector("#resetView"),
  sliceBadge: document.querySelector("#sliceBadge"),
  metricDelay: document.querySelector("#metricDelay"),
  metricDelayNote: document.querySelector("#metricDelayNote"),
  metricHeadway: document.querySelector("#metricHeadway"),
  metricHeadwayNote: document.querySelector("#metricHeadwayNote"),
  metricHotspots: document.querySelector("#metricHotspots"),
  metricSamples: document.querySelector("#metricSamples"),
  intervalValue: document.querySelector("#intervalValue"),
  intervalTrack: document.querySelector("#intervalTrack"),
  intervalNote: document.querySelector("#intervalNote"),
  canvasWrap: document.querySelector("#canvasWrap"),
  canvas: document.querySelector("#mapCanvas"),
  mapTooltip: document.querySelector("#mapTooltip"),
  mapFilterText: document.querySelector("#mapFilterText"),
  timelineTime: document.querySelector("#timelineTime"),
  timelineWindow: document.querySelector("#timelineWindow"),
  periodTag: document.querySelector("#periodTag"),
  timelineBars: document.querySelector("#timelineBars"),
  timeSlider: document.querySelector("#timeSlider"),
  playButton: document.querySelector("#playButton"),
  stationCode: document.querySelector("#stationCode"),
  stationOverview: document.querySelector("#stationOverview"),
  stationDetail: document.querySelector("#stationDetail"),
  stationDistrict: document.querySelector("#stationDistrict"),
  stationName: document.querySelector("#stationName"),
  stationDelay: document.querySelector("#stationDelay"),
  stationRoutes: document.querySelector("#stationRoutes"),
  stationRouteList: document.querySelector("#stationRouteList"),
  stationDelayFill: document.querySelector("#stationDelayFill"),
  clearStation: document.querySelector("#clearStation"),
  rawTotal: document.querySelector("#rawTotal"),
  validTotal: document.querySelector("#validTotal"),
  qualityRate: document.querySelector("#qualityRate"),
  qualityFill: document.querySelector("#qualityFill"),
  duplicateCount: document.querySelector("#duplicateCount"),
  filledCount: document.querySelector("#filledCount"),
  fieldCount: document.querySelector("#fieldCount"),
  toast: document.querySelector("#toast"),
};

const ctx = dom.canvas.getContext("2d");
const viewport = { scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0, dpr: 1 };
let currentView = null;
let playTimer = null;
let toastTimer = null;
let resizeFrame = null;

function number(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function selectedRoutes() {
  return ROUTES.filter((route) => state.routeIds.has(route.id));
}

function renderRouteList(view) {
  dom.routeList.innerHTML = ROUTES.map((route) => {
    const stats = view.routeStats.get(route.id);
    const averageDelay = stats ? stats.delaySum / stats.count : 0;
    const active = state.routeIds.has(route.id);
    return `
      <button class="route-button ${active ? "is-active" : ""}" type="button" data-route-id="${route.id}" aria-pressed="${active}">
        <span class="route-number" style="background:${route.color}">${route.label}</span>
        <span class="route-name">
          <strong>${route.name}</strong>
          <small>${route.from} ↔ ${route.to}</small>
        </span>
        <span class="route-delay ${averageDelay >= 10 ? "hot" : ""}">${averageDelay ? `${averageDelay.toFixed(1)}′` : "—"}</span>
      </button>
    `;
  }).join("");

  dom.routeCount.textContent = `${state.routeIds.size} / ${ROUTES.length}`;
  const allSelected = state.routeIds.size === ROUTES.length;
  dom.allRoutes.classList.toggle("is-active", allSelected);
  dom.allRoutes.setAttribute("aria-pressed", String(allSelected));
}

function renderMetrics(view) {
  const meta = getSliceMeta(state.sliceIndex);
  dom.sliceBadge.textContent = `${formatClock(meta.start)}—${formatClock(meta.end)} · ${meta.period}`;
  dom.metricDelay.innerHTML = `${view.averageDelay.toFixed(1)}<small>min</small>`;
  dom.metricDelayNote.textContent = `${meta.period} · 当前${state.selectedStationId ? "站点" : "筛选"}`;
  dom.metricDelayNote.classList.toggle("is-hot", view.averageDelay >= 8);
  dom.metricHeadway.innerHTML = `${Math.round(view.averageHeadway) || "—"}<small>min</small>`;
  dom.metricHeadwayNote.textContent = `${state.routeIds.size} 条线路 · 中位值`;
  dom.metricHotspots.innerHTML = `${view.highDelayStations.length}<small>处</small>`;
  dom.metricSamples.innerHTML = `${number(view.recordCount)}<small>条</small>`;
}

function renderInterval(view) {
  const samples = view.headwaySamples.length
    ? view.headwaySamples
    : selectedRoutes().map((route) => route.headway);
  const ordered = [...samples].sort((a, b) => a - b);
  const bars = Array.from({ length: 12 }, (_, index) => {
    const value = ordered[index % ordered.length] || 0;
    return Math.max(6, Math.min(100, 16 + (value / 18) * 84));
  });
  dom.intervalTrack.innerHTML = bars
    .map((height, index) => `<span style="height:${height}%;opacity:${0.4 + index * 0.045}"></span>`)
    .join("");
  dom.intervalValue.innerHTML = `${Math.round(view.averageHeadway) || "—"}<small>min</small>`;
  dom.intervalNote.textContent = `${state.routeIds.size} 条线路 · ${getSliceMeta(state.sliceIndex).period}中位值`;
}

function renderTimeline(view) {
  const meta = getSliceMeta(state.sliceIndex);
  const timeline = buildTimeline(records, state.routeIds);
  const maximum = Math.max(1, ...timeline.map((entry) => entry.averageDelay));
  dom.timelineBars.innerHTML = timeline.map((entry, index) => {
    const height = Math.max(7, Math.round((entry.averageDelay / maximum) * 100));
    const className = index === state.sliceIndex ? "is-current" : index < state.sliceIndex ? "is-past" : "";
    return `<span class="${className}" style="height:${height}%"></span>`;
  }).join("");
  dom.timelineTime.textContent = formatClock(meta.start);
  dom.timelineWindow.textContent = `${formatClock(meta.start)}—${formatClock(meta.end)}`;
  dom.periodTag.textContent = meta.period;
  dom.timeSlider.value = String(state.sliceIndex);
  dom.timeSlider.setAttribute("aria-valuetext", `${formatClock(meta.start)} 至 ${formatClock(meta.end)}，${meta.period}`);
  dom.playButton.classList.toggle("is-playing", state.playing);
  dom.playButton.setAttribute("aria-label", state.playing ? "暂停时间切片" : "播放时间切片");
  dom.intervalNote.textContent = `${state.routeIds.size} 条线路 · ${meta.period}中位值`;
  return view;
}

function renderStation(view) {
  if (!state.selectedStationId) {
    dom.stationCode.textContent = "NET";
    dom.stationOverview.classList.remove("is-hidden");
    dom.stationDetail.classList.add("is-hidden");
    return;
  }

  const station = STATION_BY_ID.get(state.selectedStationId);
  if (!station) return;
  const served = routesForStation(station.id);
  const stats = view.stationStats.get(station.id);
  const delay = stats ? stats.delaySum / stats.count : 0;
  dom.stationCode.textContent = station.code;
  dom.stationOverview.classList.add("is-hidden");
  dom.stationDetail.classList.remove("is-hidden");
  dom.stationDistrict.textContent = `${station.district} / ${station.code}`;
  dom.stationName.textContent = station.name;
  dom.stationDelay.innerHTML = `${delay.toFixed(1)}<small>min</small>`;
  dom.stationRoutes.innerHTML = `${served.length}<small>条</small>`;
  dom.stationRouteList.innerHTML = served.map((route) => (
    `<span class="station-route-chip"><i style="background:${route.color}"></i>${route.name}</span>`
  )).join("");
  dom.stationDelayFill.style.width = `${Math.max(5, Math.min(100, (delay / 15) * 100))}%`;
}

function renderReport() {
  const { report } = cleaned;
  dom.rawTotal.textContent = number(report.rawTotal);
  dom.validTotal.textContent = number(report.validTotal);
  dom.qualityRate.textContent = `${(report.qualityRate * 100).toFixed(1)}%`;
  dom.qualityFill.style.width = `${(report.qualityRate * 100).toFixed(1)}%`;
  dom.duplicateCount.innerHTML = `${number(report.removedDuplicates)}<small>条</small>`;
  dom.filledCount.innerHTML = `${number(report.filledRecords)}<small>条</small>`;
  dom.fieldCount.innerHTML = `${number(report.filledFields)}<small>个</small>`;
}

function renderFilterLabel() {
  if (state.selectedStationId) {
    const station = STATION_BY_ID.get(state.selectedStationId);
    dom.mapFilterText.textContent = `${station.name} · ${state.routeIds.size} 条经过线路`;
  } else if (state.routeIds.size < ROUTES.length) {
    dom.mapFilterText.textContent = `${selectedRoutes().map((route) => route.name).join(" / ")} · 单线视图`;
  } else {
    dom.mapFilterText.textContent = "全网视图 · 6 条运营线路";
  }
}

const arterialRoads = [
  { points: [[-20, 242], [175, 246], [352, 208], [558, 244], [770, 210], [1020, 240]], width: 6 },
  { points: [[-20, 470], [160, 455], [350, 420], [570, 452], [790, 500], [1020, 486]], width: 5 },
  { points: [[280, -20], [298, 165], [340, 360], [382, 575], [390, 720]], width: 7 },
  { points: [[635, -20], [650, 150], [684, 340], [730, 530], [748, 720]], width: 6 },
  { points: [[910, -20], [895, 160], [860, 360], [872, 560], [842, 720]], width: 4 },
  { points: [[-20, 612], [200, 596], [410, 590], [650, 620], [860, 660], [1020, 645]], width: 4 },
];

const cityBlocks = [
  [55, 88, 74, 44], [145, 80, 104, 48], [360, 76, 74, 52], [445, 76, 86, 52],
  [540, 92, 70, 38], [656, 78, 88, 54], [755, 84, 74, 44], [842, 92, 58, 42],
  [62, 310, 77, 52], [154, 300, 90, 55], [185, 386, 80, 58], [286, 315, 74, 48],
  [382, 284, 65, 45], [472, 322, 82, 55], [568, 314, 64, 54], [646, 286, 86, 58],
  [754, 286, 82, 48], [740, 360, 70, 46], [832, 342, 64, 45], [236, 482, 88, 50],
  [400, 476, 70, 46], [664, 482, 70, 44], [768, 470, 66, 46], [875, 552, 60, 44],
];

function traceSmooth(context, points) {
  if (!points.length) return;
  context.moveTo(points[0][0], points[0][1]);
  if (points.length === 2) {
    context.lineTo(points[1][0], points[1][1]);
    return;
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    const midX = (point[0] + next[0]) / 2;
    const midY = (point[1] + next[1]) / 2;
    context.quadraticCurveTo(point[0], point[1], midX, midY);
  }
  context.lineTo(points.at(-1)[0], points.at(-1)[1]);
}

function roundedPath(context, x, y, width, height, radius) {
  const value = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + value, y);
  context.arcTo(x + width, y, x + width, y + height, value);
  context.arcTo(x + width, y + height, x, y + height, value);
  context.arcTo(x, y + height, x, y, value);
  context.arcTo(x, y, x + width, y, value);
  context.closePath();
}

function resizeCanvas() {
  const bounds = dom.canvasWrap.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (dom.canvas.width !== pixelWidth || dom.canvas.height !== pixelHeight) {
    dom.canvas.width = pixelWidth;
    dom.canvas.height = pixelHeight;
  }
  const scale = Math.min((width - 28) / WORLD.width, (height - 20) / WORLD.height);
  viewport.scale = scale;
  viewport.offsetX = (width - WORLD.width * scale) / 2;
  viewport.offsetY = (height - WORLD.height * scale) / 2;
  viewport.width = width;
  viewport.height = height;
  viewport.dpr = dpr;
}

function drawBaseMap(context, width, height) {
  const background = context.createRadialGradient(width * 0.48, height * 0.42, 20, width * 0.48, height * 0.42, width * 0.72);
  background.addColorStop(0, "#0d2231");
  background.addColorStop(0.55, "#091827");
  background.addColorStop(1, "#06101c");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(475, 315, 10, 475, 315, 330);
  glow.addColorStop(0, "rgba(38, 108, 111, 0.11)");
  glow.addColorStop(1, "rgba(38, 108, 111, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.save();
  context.translate(viewport.offsetX, viewport.offsetY);
  context.scale(viewport.scale, viewport.scale);

  context.fillStyle = "rgba(6, 17, 28, 0.7)";
  context.fillRect(0, 0, WORLD.width, WORLD.height);

  context.strokeStyle = "rgba(103, 145, 163, 0.055)";
  context.lineWidth = 0.7;
  for (let x = 0; x < WORLD.width; x += 50) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, WORLD.height);
    context.stroke();
  }
  for (let y = 0; y < WORLD.height; y += 50) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(WORLD.width, y);
    context.stroke();
  }

  for (const district of DISTRICTS) {
    context.beginPath();
    district.points.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fillStyle = "rgba(15, 42, 54, 0.18)";
    context.strokeStyle = "rgba(102, 146, 160, 0.06)";
    context.lineWidth = 1;
    context.fill();
    context.stroke();
  }

  for (const [x, y, widthValue, heightValue] of cityBlocks) {
    roundedPath(context, x, y, widthValue, heightValue, 2);
    context.fillStyle = "rgba(17, 39, 56, 0.6)";
    context.strokeStyle = "rgba(89, 130, 150, 0.11)";
    context.lineWidth = 0.8;
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(x + 5, y + heightValue * 0.43);
    context.lineTo(x + widthValue - 5, y + heightValue * 0.43);
    context.strokeStyle = "rgba(89, 130, 150, 0.06)";
    context.stroke();
  }

  context.strokeStyle = "rgba(15, 49, 68, 0.92)";
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(30, 100);
  context.bezierCurveTo(250, 128, 356, 232, 475, 408);
  context.bezierCurveTo(580, 545, 764, 612, 980, 692);
  context.lineWidth = 45;
  context.stroke();
  context.strokeStyle = "rgba(45, 111, 128, 0.16)";
  context.lineWidth = 1.2;
  context.stroke();

  for (const road of arterialRoads) {
    context.beginPath();
    traceSmooth(context, road.points);
    context.strokeStyle = "rgba(26, 50, 68, 0.65)";
    context.lineWidth = road.width + 3;
    context.stroke();
    context.beginPath();
    traceSmooth(context, road.points);
    context.strokeStyle = "rgba(65, 98, 117, 0.14)";
    context.lineWidth = road.width;
    context.stroke();
    context.beginPath();
    traceSmooth(context, road.points);
    context.strokeStyle = "rgba(128, 169, 183, 0.11)";
    context.lineWidth = 0.7;
    context.stroke();
  }

  context.save();
  context.globalAlpha = 0.28;
  context.fillStyle = "#0d312e";
  roundedPath(context, 535, 215, 118, 83, 14);
  context.fill();
  context.strokeStyle = "rgba(83, 174, 139, 0.25)";
  context.lineWidth = 1;
  context.stroke();
  context.restore();

  context.save();
  context.font = "500 8px 'DM Mono', monospace";
  context.fillStyle = "rgba(118, 157, 169, 0.38)";
  context.letterSpacing = "1px";
  const districtLabels = [
    ["西郊片区", 115, 65], ["北城", 465, 48], ["老城", 375, 355],
    ["东城", 804, 90], ["南岸", 195, 637],
  ];
  for (const [text, x, y] of districtLabels) {
    context.fillText(text, x, y);
  }
  context.restore();

  for (const label of ROAD_LABELS) {
    context.save();
    context.translate(label.x, label.y);
    context.rotate(label.angle);
    context.font = "400 7px 'DM Mono', monospace";
    context.fillStyle = "rgba(130, 159, 169, 0.34)";
    context.fillText(label.text, 0, 0);
    context.restore();
  }

  const mapGradient = context.createLinearGradient(0, 0, WORLD.width, 0);
  mapGradient.addColorStop(0, "rgba(6, 15, 25, 0.26)");
  mapGradient.addColorStop(0.5, "rgba(6, 15, 25, 0)");
  mapGradient.addColorStop(1, "rgba(6, 15, 25, 0.24)");
  context.fillStyle = mapGradient;
  context.fillRect(0, 0, WORLD.width, WORLD.height);
  context.restore();
}

function routePoints(route) {
  return route.stops.map((stopId) => {
    const station = STATION_BY_ID.get(stopId);
    return { x: station.x, y: station.y };
  });
}

function pointOnRoute(points, progress) {
  if (points.length === 1) return points[0];
  const scaled = Math.max(0, Math.min(1, progress)) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(scaled));
  const fraction = scaled - index;
  const start = points[index];
  const end = points[index + 1];
  return {
    x: start.x + (end.x - start.x) * fraction,
    y: start.y + (end.y - start.y) * fraction,
  };
}

function drawHeatZones(context, view) {
  const activeStops = new Set(
    selectedRoutes().flatMap((route) => route.stops),
  );
  context.save();
  context.globalCompositeOperation = "lighter";

  for (const stopId of activeStops) {
    const stats = view.stationStats.get(stopId);
    if (!stats) continue;
    const delay = stats.delaySum / stats.count;
    if (delay < 4.2) continue;
    const station = STATION_BY_ID.get(stopId);
    const intensity = Math.min(1, (delay - 3) / 12);
    const radius = 22 + intensity * 62;
    const gradient = context.createRadialGradient(station.x, station.y, 1, station.x, station.y, radius);
    const coreAlpha = 0.14 + intensity * 0.17;
    const middleAlpha = 0.075 + intensity * 0.095;
    gradient.addColorStop(0, `rgba(255, 219, 120, ${coreAlpha})`);
    gradient.addColorStop(0.26, `rgba(255, 137, 63, ${middleAlpha})`);
    gradient.addColorStop(0.58, `rgba(255, 75, 82, ${middleAlpha * 0.55})`);
    gradient.addColorStop(1, "rgba(255, 68, 86, 0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(station.x, station.y, radius, 0, Math.PI * 2);
    context.fill();

    context.beginPath();
    context.arc(station.x, station.y, radius * 0.62, 0, Math.PI * 2);
    context.strokeStyle = `rgba(255, 181, 91, ${0.035 + intensity * 0.055})`;
    context.lineWidth = 0.7;
    context.setLineDash([2, 4]);
    context.stroke();
    context.setLineDash([]);
  }
  context.restore();
}

function drawBus(context, point, color, latest) {
  context.save();
  context.shadowColor = color;
  context.shadowBlur = latest ? 8 : 4;
  context.fillStyle = latest ? "#f4fffd" : color;
  context.beginPath();
  context.arc(point.x, point.y, latest ? 2.7 : 2, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.beginPath();
  context.arc(point.x, point.y, latest ? 4.8 : 3.5, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

function drawRouteLine(context, route, points, isActive) {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  traceSmooth(context, points.map((point) => [point.x, point.y]));
  context.strokeStyle = "rgba(3, 11, 19, 0.75)";
  context.lineWidth = isActive ? 7 : 5;
  context.stroke();

  context.beginPath();
  traceSmooth(context, points.map((point) => [point.x, point.y]));
  context.globalAlpha = isActive ? 0.93 : 0.1;
  context.strokeStyle = route.color;
  context.lineWidth = isActive ? 2.25 : 1.2;
  context.shadowColor = route.color;
  context.shadowBlur = isActive ? 9 : 2;
  context.stroke();

  if (isActive) {
    context.beginPath();
    traceSmooth(context, points.map((point) => [point.x, point.y]));
    context.globalAlpha = 0.24;
    context.shadowBlur = 0;
    context.strokeStyle = "#f5ffff";
    context.lineWidth = 0.65;
    context.stroke();
  }
  context.restore();
}

function drawRouteLabel(context, route, points, progress) {
  const anchor = pointOnRoute(points, progress);
  const width = route.label.length > 1 ? 29 : 25;
  const x = anchor.x - width / 2;
  const y = anchor.y - 18;
  context.save();
  context.shadowColor = route.color;
  context.shadowBlur = 6;
  roundedPath(context, x, y, width, 12, 3);
  context.fillStyle = route.color;
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "#06111b";
  context.font = "600 5.8px 'DejaVu Sans Mono', monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(`${route.label}·${route.headway}′`, anchor.x, y + 6.2);
  context.restore();
}

function drawBuses(context) {
  const currentMinute = getSliceMeta(state.sliceIndex).start + 15;
  const activeRoutes = selectedRoutes();
  for (const route of activeRoutes) {
    const points = routePoints(route);
    const totalTravel = (route.stops.length - 1) * 7;
    const firstDeparture = DAY_START + route.phase;
    const baseOffset = ((currentMinute - firstDeparture) % route.headway + route.headway) % route.headway;
    let count = 0;
    for (let offset = baseOffset; offset <= totalTravel && count < 3; offset += route.headway) {
      drawBus(context, pointOnRoute(points, offset / totalTravel), route.color, count === 0);
      count += 1;
    }
  }
}

function drawStations(context, view) {
  const activeStops = new Set(selectedRoutes().flatMap((route) => route.stops));
  const hotspotStops = new Set(view.highDelayStations.slice(0, 5).map((entry) => entry.stopId));
  const stationRoutes = new Map();
  for (const route of selectedRoutes()) {
    for (const stopId of route.stops) {
      const colors = stationRoutes.get(stopId) || [];
      colors.push(route.color);
      stationRoutes.set(stopId, colors);
    }
  }

  for (const station of STATIONS) {
    if (activeStops.has(station.id)) continue;
    context.beginPath();
    context.arc(station.x, station.y, 1.7, 0, Math.PI * 2);
    context.fillStyle = "rgba(83, 117, 137, 0.32)";
    context.fill();
  }

  for (const stopId of activeStops) {
    const station = STATION_BY_ID.get(stopId);
    const colors = stationRoutes.get(stopId) || ["#d8f7f2"];
    const stats = view.stationStats.get(stopId);
    const delay = stats ? stats.delaySum / stats.count : 0;
    const selected = state.selectedStationId === stopId;
    const hovered = state.hoverStationId === stopId;

    if (selected) {
      const pulse = context.createRadialGradient(station.x, station.y, 2, station.x, station.y, 28);
      pulse.addColorStop(0, "rgba(98, 232, 208, 0.17)");
      pulse.addColorStop(0.65, "rgba(98, 232, 208, 0.035)");
      pulse.addColorStop(1, "rgba(98, 232, 208, 0)");
      context.fillStyle = pulse;
      context.beginPath();
      context.arc(station.x, station.y, 28, 0, Math.PI * 2);
      context.fill();
    }

    context.beginPath();
    context.arc(station.x, station.y, hovered || selected ? 6.2 : 3.6, 0, Math.PI * 2);
    context.fillStyle = "#07111d";
    context.fill();
    context.strokeStyle = selected ? "#62e8d0" : colors[0];
    context.lineWidth = selected ? 2 : 1.4;
    context.stroke();
    context.beginPath();
    context.arc(station.x, station.y, selected ? 3 : 1.8, 0, Math.PI * 2);
    context.fillStyle = selected ? "#f4fffd" : "#c9e6e7";
    context.fill();

    if (selected) {
      context.beginPath();
      context.arc(station.x, station.y, 10.5, 0, Math.PI * 2);
      context.strokeStyle = "rgba(98, 232, 208, 0.54)";
      context.lineWidth = 0.8;
      context.setLineDash([2.4, 3.2]);
      context.stroke();
      context.setLineDash([]);
    }

    const important = selected || hovered || ["civic-plaza", "east-station", "north-gate", "west-hub", "expo", "south-lake"].includes(stopId);
    context.font = selected || hovered
      ? "600 9.2px 'Noto Sans SC Local', sans-serif"
      : `500 ${important ? 8.1 : 7.4}px 'Noto Sans SC Local', sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillStyle = selected
      ? "rgba(239, 255, 252, 0.98)"
      : hovered
        ? "rgba(219, 244, 242, 0.9)"
        : important
          ? "rgba(154, 183, 193, 0.78)"
          : "rgba(119, 149, 162, 0.63)";
    context.fillText(station.name, station.x + 9, station.y - 8);

    if (!selected && stats && hotspotStops.has(stopId)) {
      context.font = "500 6.2px 'DejaVu Sans Mono', monospace";
      context.fillStyle = "rgba(255, 161, 103, 0.9)";
      context.fillText(`${delay.toFixed(1)}′`, station.x + 9, station.y + 3);
    }

    if (selected && stats) {
      context.font = "400 6.8px 'DM Mono', monospace";
      context.fillStyle = delay >= 8 ? "rgba(255, 152, 112, 0.9)" : "rgba(98, 232, 208, 0.82)";
      context.fillText(`${delay.toFixed(1)} MIN DELAY`, station.x + 9, station.y + 5);
    }
  }
}

function drawCompass(context) {
  context.save();
  context.translate(951, 641);
  context.strokeStyle = "rgba(125, 162, 174, 0.22)";
  context.lineWidth = 0.7;
  context.beginPath();
  context.arc(0, 0, 15, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(0, -10);
  context.lineTo(3, 4);
  context.lineTo(0, 2);
  context.lineTo(-3, 4);
  context.closePath();
  context.fillStyle = "rgba(98, 232, 208, 0.36)";
  context.fill();
  context.font = "500 6px 'DM Mono', monospace";
  context.textAlign = "center";
  context.fillStyle = "rgba(128, 166, 177, 0.5)";
  context.fillText("N", 0, -21);
  context.restore();
}

function renderMap(view) {
  resizeCanvas();
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  drawBaseMap(ctx, viewport.width, viewport.height);

  ctx.save();
  ctx.translate(viewport.offsetX, viewport.offsetY);
  ctx.scale(viewport.scale, viewport.scale);
  drawHeatZones(ctx, view);

  const progressByRoute = { r1: 0.19, r7: 0.73, r18: 0.47, r24: 0.8, r36: 0.36, r52: 0.63 };
  for (const route of ROUTES) {
    if (state.routeIds.has(route.id)) continue;
    drawRouteLine(ctx, route, routePoints(route), false);
  }
  for (const route of selectedRoutes()) {
    const points = routePoints(route);
    drawRouteLine(ctx, route, points, true);
  }
  drawBuses(ctx);
  for (const route of selectedRoutes()) {
    drawRouteLabel(ctx, route, routePoints(route), progressByRoute[route.id] || 0.5);
  }
  drawStations(ctx, view);
  drawCompass(ctx);
  ctx.restore();
}

function renderAll() {
  currentView = buildView(records, state.sliceIndex, state.routeIds);
  renderRouteList(currentView);
  renderMetrics(currentView);
  renderInterval(currentView);
  renderTimeline(currentView);
  renderStation(currentView);
  renderFilterLabel();
  renderMap(currentView);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), 1700);
}

function setSlice(index) {
  state.sliceIndex = Math.max(0, Math.min(SLICE_COUNT - 1, Number(index)));
  renderAll();
}

function selectStation(stationId) {
  const station = STATION_BY_ID.get(stationId);
  if (!station) return;
  const served = routesForStation(stationId);
  state.selectedStationId = stationId;
  state.directRouteId = null;
  state.routeIds = new Set(served.map((route) => route.id));
  state.hoverStationId = stationId;
  renderAll();
  showToast(`${station.name}：已筛选 ${served.length} 条经过线路`);
}

function selectRoute(routeId) {
  const route = ROUTE_BY_ID.get(routeId);
  if (!route) return;
  if (state.routeIds.size === 1 && state.routeIds.has(routeId) && !state.selectedStationId) {
    resetView();
    return;
  }
  state.routeIds = new Set([routeId]);
  state.selectedStationId = null;
  state.directRouteId = routeId;
  state.hoverStationId = null;
  renderAll();
  showToast(`单线视图：${route.name} · ${route.from} ↔ ${route.to}`);
}

function resetView() {
  state.sliceIndex = state.sliceIndex;
  state.routeIds = new Set(allRouteIds);
  state.selectedStationId = null;
  state.directRouteId = null;
  state.hoverStationId = null;
  dom.mapTooltip.style.display = "none";
  renderAll();
  showToast("已恢复全网视图");
}

function stationCanvasPoint(stationId) {
  const station = STATION_BY_ID.get(stationId);
  const rect = dom.canvas.getBoundingClientRect();
  return {
    x: rect.left + viewport.offsetX + station.x * viewport.scale,
    y: rect.top + viewport.offsetY + station.y * viewport.scale,
  };
}

function stationAtPointer(clientX, clientY) {
  const rect = dom.canvas.getBoundingClientRect();
  const worldX = (clientX - rect.left - viewport.offsetX) / viewport.scale;
  const worldY = (clientY - rect.top - viewport.offsetY) / viewport.scale;
  const threshold = 18 / viewport.scale;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const station of STATIONS) {
    const distance = Math.hypot(station.x - worldX, station.y - worldY);
    if (distance < threshold && distance < nearestDistance) {
      nearest = station;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function positionTooltip(station, clientX, clientY) {
  if (!station || !currentView) {
    dom.mapTooltip.style.display = "none";
    return;
  }
  const stats = currentView.stationStats.get(station.id);
  const delay = stats ? stats.delaySum / stats.count : 0;
  const served = routesForStation(station.id);
  const wrapBounds = dom.canvasWrap.getBoundingClientRect();
  const left = Math.min(wrapBounds.width - 130, Math.max(8, clientX - wrapBounds.left + 15));
  const top = Math.min(wrapBounds.height - 56, Math.max(8, clientY - wrapBounds.top + 14));
  dom.mapTooltip.innerHTML = `<strong>${station.name}</strong><span>${served.length} 条线路 · ${delay.toFixed(1)} min 延误</span>`;
  dom.mapTooltip.style.left = `${left}px`;
  dom.mapTooltip.style.top = `${top}px`;
  dom.mapTooltip.style.display = "block";
}

function handlePointerMove(event) {
  const station = stationAtPointer(event.clientX, event.clientY);
  const nextId = station?.id || null;
  const changed = nextId !== state.hoverStationId;
  state.hoverStationId = nextId;
  dom.canvas.style.cursor = station ? "pointer" : "crosshair";
  if (changed && currentView) renderMap(currentView);
  if (station) {
    positionTooltip(station, event.clientX, event.clientY);
  } else {
    dom.mapTooltip.style.display = "none";
  }
}

function handleCanvasClick(event) {
  const station = stationAtPointer(event.clientX, event.clientY);
  if (station) selectStation(station.id);
}

function focusStationByOffset(offset) {
  const activeStops = new Set(selectedRoutes().flatMap((route) => route.stops));
  const candidates = STATIONS.filter((station) => activeStops.has(station.id));
  const currentIndex = Math.max(0, candidates.findIndex((station) => station.id === state.hoverStationId));
  state.focusStationIndex = (currentIndex + offset + candidates.length) % candidates.length;
  const station = candidates[state.focusStationIndex];
  if (!station) return;
  state.hoverStationId = station.id;
  renderMap(currentView);
  const point = stationCanvasPoint(station.id);
  positionTooltip(station, point.x, point.y);
}

function handleCanvasKeydown(event) {
  if (["ArrowRight", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    focusStationByOffset(1);
  } else if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    focusStationByOffset(-1);
  } else if (event.key === "Enter" || event.key === " ") {
    const activeStops = new Set(selectedRoutes().flatMap((route) => route.stops));
    const candidates = STATIONS.filter((station) => activeStops.has(station.id));
    const station = STATION_BY_ID.get(state.hoverStationId)
      || candidates[state.focusStationIndex]
      || STATION_BY_ID.get("civic-plaza");
    event.preventDefault();
    if (station) selectStation(station.id);
  } else if (event.key === "Escape") {
    resetView();
  }
}

function togglePlayback() {
  state.playing = !state.playing;
  if (state.playing) {
    playTimer = window.setInterval(() => {
      state.sliceIndex = (state.sliceIndex + 1) % SLICE_COUNT;
      renderAll();
    }, 720);
  } else {
    window.clearInterval(playTimer);
    playTimer = null;
  }
  dom.playButton.classList.toggle("is-playing", state.playing);
  dom.playButton.setAttribute("aria-label", state.playing ? "暂停时间切片" : "播放时间切片");
}

dom.routeList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-route-id]");
  if (button) selectRoute(button.dataset.routeId);
});
dom.allRoutes.addEventListener("click", resetView);
dom.resetView.addEventListener("click", resetView);
dom.clearStation.addEventListener("click", resetView);
dom.timeSlider.addEventListener("input", (event) => setSlice(event.target.value));
dom.playButton.addEventListener("click", togglePlayback);
dom.canvas.addEventListener("pointermove", handlePointerMove);
dom.canvas.addEventListener("pointerleave", () => {
  state.hoverStationId = null;
  dom.mapTooltip.style.display = "none";
  if (currentView) renderMap(currentView);
});
dom.canvas.addEventListener("click", handleCanvasClick);
dom.canvas.addEventListener("keydown", handleCanvasKeydown);

const resizeObserver = new ResizeObserver(() => {
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    resizeCanvas();
    if (currentView) renderMap(currentView);
  });
});
resizeObserver.observe(dom.canvasWrap);

renderReport();
renderAll();

window.__transitApp = {
  getState: () => ({
    sliceIndex: state.sliceIndex,
    sliceStart: getSliceMeta(state.sliceIndex).start,
    sliceLabel: `${formatClock(getSliceMeta(state.sliceIndex).start)}—${formatClock(getSliceMeta(state.sliceIndex).end)}`,
    routeIds: [...state.routeIds],
    selectedStationId: state.selectedStationId,
  }),
  getMetrics: () => currentView ? {
    averageDelay: currentView.averageDelay,
    averageHeadway: currentView.averageHeadway,
    highDelayStations: currentView.highDelayStations.length,
    recordCount: currentView.recordCount,
  } : null,
  getStationClientPoint: (stationId) => stationCanvasPoint(stationId),
  selectRoute,
  selectStation,
  setSlice,
  resetView,
};
