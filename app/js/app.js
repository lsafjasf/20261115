import { ROUTES } from "./data.js";
import { renderMap } from "./map.js";
import { renderSpeedChart } from "./speedChart.js";
import { exportReport } from "./report.js";
import { formatClock, formatDur } from "./util.js";

const els = {
  routeSelect: document.getElementById("routeSelect"),
  rangeStart: document.getElementById("rangeStart"),
  rangeEnd: document.getElementById("rangeEnd"),
  rangeStartText: document.getElementById("rangeStartText"),
  rangeEndText: document.getElementById("rangeEndText"),
  rangeReset: document.getElementById("rangeReset"),
  fSpeed: document.getElementById("fSpeed"),
  fReverse: document.getElementById("fReverse"),
  fSkip: document.getElementById("fSkip"),
  cntSpeed: document.getElementById("cntSpeed"),
  cntReverse: document.getElementById("cntReverse"),
  cntSkip: document.getElementById("cntSkip"),
  playBtn: document.getElementById("playBtn"),
  cursorTime: document.getElementById("cursorTime"),
  mapCanvas: document.getElementById("mapCanvas"),
  speedCanvas: document.getElementById("speedCanvas"),
  stationList: document.getElementById("stationList"),
  anomalyList: document.getElementById("anomalyList"),
  exportBtn: document.getElementById("exportBtn"),
};

const TYPE_LABEL = { speed: "超速", reverse: "逆行", skip: "未停靠" };

const state = {
  routeIdx: 0,
  window: [0, 0],
  cursor: 0,
  filters: { speed: true, reverse: true, skip: true },
  playing: false,
  playTimer: null,
};

function route() {
  return ROUTES[state.routeIdx];
}

function jumpTo(t) {
  const r = route();
  state.cursor = Math.max(0, Math.min(r.samples.length - 1, t));
  const [w0, w1] = state.window;
  if (state.cursor < w0 || state.cursor > w1) {
    const half = Math.max(20, Math.round((w1 - w0) / 2));
    state.window = [
      Math.max(0, state.cursor - half),
      Math.min(r.samples.length - 1, state.cursor + half),
    ];
    syncRangeInputs();
  }
  render();
}

function syncRangeInputs() {
  const r = route();
  const n = r.samples.length - 1;
  els.rangeStart.value = Math.round((state.window[0] / n) * 100);
  els.rangeEnd.value = Math.round((state.window[1] / n) * 100);
  els.rangeStartText.textContent = formatClock(r.samples[state.window[0]].clock);
  els.rangeEndText.textContent = formatClock(r.samples[state.window[1]].clock);
}

function inWindow(t) {
  return t >= state.window[0] && t <= state.window[1];
}

function render() {
  const r = route();
  const mapHandle = renderMap(els.mapCanvas, r, state);
  const chartHandle = renderSpeedChart(els.speedCanvas, r, state);
  els.mapCanvas._hitTest = mapHandle.hitTest;
  els.speedCanvas._hitTest = chartHandle.hitTest;

  const cur = r.samples[state.cursor];
  els.cursorTime.textContent = `${formatClock(cur.clock)} · ${cur.speed} km/h`;

  const counts = { speed: 0, reverse: 0, skip: 0 };
  for (const a of r.anomalies) {
    const inside = a.type === "skip" ? inWindow(a.start) : (a.end >= state.window[0] && a.start <= state.window[1]);
    if (inside) counts[a.type] += 1;
  }
  els.cntSpeed.textContent = counts.speed;
  els.cntReverse.textContent = counts.reverse;
  els.cntSkip.textContent = counts.skip;

  renderStations(r);
  renderAnomalies(r);
  syncRangeInputs();
}

function renderStations(r) {
  els.stationList.innerHTML = "";
  for (const st of r.stations) {
    const near = r.samples.reduce((best, p) =>
      Math.abs(p.s - st.s) < Math.abs(best.s - st.s) ? p : best);
    const skipped = !st.dwell || st.dwell === 0;
    const outside = !inWindow(near.t);
    const item = document.createElement("div");
    item.className = `station-item ${skipped ? "skip" : ""} ${outside ? "outside" : ""}`;
    item.innerHTML = `
      <span class="s-name">${st.name}</span>
      <span class="s-meta">${skipped ? "越站通过" : `停靠 ${st.dwellSec}s`}</span>
      <span class="badge ${skipped ? "skip" : "ok"}">${skipped ? "未停靠" : "正常"}</span>`;
    item.title = `跳转到 ${formatClock(near.clock)}`;
    item.addEventListener("click", () => jumpTo(near.t));
    els.stationList.appendChild(item);
  }
}

function renderAnomalies(r) {
  els.anomalyList.innerHTML = "";
  for (const a of r.anomalies) {
    if (!state.filters[a.type]) continue;
    const inside = a.type === "skip" ? inWindow(a.start) : (a.end >= state.window[0] && a.start <= state.window[1]);
    const item = document.createElement("div");
    item.className = `anomaly-item type-${a.type} ${inside ? "" : "outside"}`;
    const clock = formatClock(r.samples[a.start].clock);
    let desc;
    if (a.type === "speed") desc = `峰值 ${a.peak} km/h，限速 ${a.speedLimit}`;
    else if (a.type === "reverse") desc = `逆行 ${formatDur(a.end - a.start)}，峰值 ${a.peak} km/h`;
    else desc = `${a.stationName} 未停靠通过`;
    item.innerHTML = `
      <span class="a-time">${clock}</span>
      <span><b class="a-type">${TYPE_LABEL[a.type]}</b> ${desc}</span>
      <span class="a-jump">跳转 ➜</span>`;
    item.addEventListener("click", () => jumpTo(a.start));
    els.anomalyList.appendChild(item);
  }
}

function onRangeInput() {
  const r = route();
  const n = r.samples.length - 1;
  let a = Math.round((Number(els.rangeStart.value) / 100) * n);
  let b = Math.round((Number(els.rangeEnd.value) / 100) * n);
  if (a > b) {
    if (document.activeElement === els.rangeStart) a = b;
    else b = a;
  }
  state.window = [a, b];
  if (state.cursor < a) state.cursor = a;
  if (state.cursor > b) state.cursor = b;
  render();
}

function stopPlay() {
  state.playing = false;
  clearInterval(state.playTimer);
  els.playBtn.textContent = "▶ 播放";
}

function togglePlay() {
  if (state.playing) {
    stopPlay();
    return;
  }
  state.playing = true;
  els.playBtn.textContent = "⏸ 暂停";
  state.playTimer = setInterval(() => {
    if (state.cursor >= state.window[1]) {
      state.cursor = state.window[0];
    } else {
      state.cursor = Math.min(state.window[1], state.cursor + 5);
    }
    render();
  }, 120);
}

function init() {
  for (const r of ROUTES) {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.name;
    els.routeSelect.appendChild(opt);
  }

  els.routeSelect.addEventListener("change", () => {
    stopPlay();
    state.routeIdx = els.routeSelect.selectedIndex;
    const n = route().samples.length - 1;
    state.window = [0, n];
    state.cursor = 0;
    syncRangeInputs();
    render();
  });

  els.rangeStart.addEventListener("input", onRangeInput);
  els.rangeEnd.addEventListener("input", onRangeInput);
  els.rangeReset.addEventListener("click", () => {
    state.window = [0, route().samples.length - 1];
    state.cursor = state.window[0];
    render();
  });

  els.fSpeed.addEventListener("change", () => { state.filters.speed = els.fSpeed.checked; render(); });
  els.fReverse.addEventListener("change", () => { state.filters.reverse = els.fReverse.checked; render(); });
  els.fSkip.addEventListener("change", () => { state.filters.skip = els.fSkip.checked; render(); });

  els.playBtn.addEventListener("click", togglePlay);
  els.exportBtn.addEventListener("click", () => exportReport(route(), state));

  els.mapCanvas.addEventListener("click", (e) => {
    const rect = els.mapCanvas.getBoundingClientRect();
    const hit = els.mapCanvas._hitTest?.(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) jumpTo(hit.t);
  });

  els.speedCanvas.addEventListener("click", (e) => {
    const rect = els.speedCanvas.getBoundingClientRect();
    const t = els.speedCanvas._hitTest?.(e.clientX - rect.left);
    if (t !== null && t !== undefined) jumpTo(t);
  });

  window.addEventListener("resize", () => render());

  state.window = [0, route().samples.length - 1];
  state.cursor = 0;
  render();

  window.__audit = {
    get state() { return state; },
    get routes() { return ROUTES; },
    jumpTo,
  };
}

init();
