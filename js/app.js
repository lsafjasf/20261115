import { MAP_GEOMETRY, PERIODS, PERIOD_STATS } from "./data.js";
import { calculateSelectionStats, normalizeRect, statsConsistencyCheck } from "./selection.js";
import { HeatMapRenderer, temperatureHex } from "./renderer.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const format = (value) => Number(value).toFixed(1);

const canvas = $("#mapCanvas");
const mapFrame = $("#mapFrame");
const tooltip = $("#mapTooltip");
const layerButtons = $$(".layer-option");
const comparisonRows = $$(".comparison-row");

const els = {
  exportButton: $("#exportButton"),
  mapStatus: $("#mapStatus"),
  mapInstructions: $("#mapInstructions"),
  periodName: $("#periodName"),
  periodChip: $("#periodChip"),
  heroTemp: $("#heroTemp"),
  rangeMin: $("#rangeMin"),
  rangeMax: $("#rangeMax"),
  deltaNote: $("#deltaNote"),
  clearSelectionButton: $("#clearSelectionButton"),
  selectionEmpty: $("#selectionEmpty"),
  selectionResult: $("#selectionResult"),
  selectionAverage: $("#selectionAverage"),
  selectionSwatch: $("#selectionSwatch"),
  selectionCount: $("#selectionCount"),
  selectionArea: $("#selectionArea"),
  selectionMin: $("#selectionMin"),
  selectionMax: $("#selectionMax"),
  selectionDelta: $("#selectionDelta"),
  selectionCaption: $("#selectionCaption"),
  spreadFill: $("#spreadFill"),
  spreadMean: $("#spreadMean"),
  filterToggle: $("#filterToggle"),
  thresholdSlider: $("#thresholdSlider"),
  thresholdValue: $("#thresholdValue"),
  thresholdMin: $("#thresholdMin"),
  thresholdMax: $("#thresholdMax"),
  filterCount: $("#filterCount"),
  filterSummary: $("#filterSummary"),
  tooltipBlock: $("#tooltipBlock"),
  tooltipLayer: $("#tooltipLayer"),
  tooltipTemp: $("#tooltipTemp"),
  tooltipBuilding: $("#tooltipBuilding"),
  tooltipDelta: $("#tooltipDelta"),
};

const state = {
  period: "day",
  hoverId: null,
  selectionRect: null,
  selectionStats: null,
  dragRect: null,
  filter: {
    enabled: false,
    threshold: PERIOD_STATS.day.average,
  },
};

const renderer = new HeatMapRenderer(canvas);
let dragPointerId = null;
let dragStartScreen = null;
let dragStartWorld = null;
let statusTimer = null;

function currentStats() {
  return PERIOD_STATS[state.period];
}

function render() {
  renderer.render({
    period: state.period,
    hoverId: state.hoverId,
    selectedIds: state.selectionStats?.selectedIds || [],
    selectionRect: state.selectionRect,
    selectionStats: state.selectionStats,
    dragRect: state.dragRect,
    filter: state.filter,
  });
}

function setMapStatus(message, temporary = false) {
  window.clearTimeout(statusTimer);
  els.mapStatus.textContent = message;
  if (temporary) {
    statusTimer = window.setTimeout(() => {
      setMapStatus(`${PERIODS[state.period].label}图层已载入`);
    }, 2600);
  }
}

function updateLayerLabels() {
  for (const [periodKey, period] of Object.entries(PERIODS)) {
    const stats = PERIOD_STATS[periodKey];
    const layerButton = layerButtons.find((button) => button.dataset.layer === periodKey);
    const comparisonRow = comparisonRows.find((button) => button.dataset.layer === periodKey);
    layerButton.querySelector("em").textContent = `${format(stats.average)}°`;
    const rowValue = comparisonRow.querySelector("strong");
    rowValue.textContent = `${format(stats.average)}°`;
    const bar = comparisonRow.querySelector(".compare-bar i");
    const normalized = (stats.average - 24) / (46 - 24);
    bar.style.setProperty("--size", `${Math.round(clamp(normalized, 0, 1) * 100)}%`);
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updateDelta(periodKey) {
  const stats = PERIOD_STATS[periodKey];
  const baseline = PERIOD_STATS.day.average;
  const delta = stats.average - baseline;
  const badge = document.createElement("span");
  const text = document.createElement("span");

  if (periodKey === "day") {
    badge.className = "delta-badge neutral";
    badge.textContent = "基准";
    text.textContent = "日间基准时段";
  } else {
    badge.className = `delta-badge ${delta < 0 ? "cool" : "warm"}`;
    badge.textContent = `${delta > 0 ? "+" : ""}${format(delta)}°C`;
    text.textContent = `较白天平均 ${delta < 0 ? "低" : "高"} ${format(Math.abs(delta))}°C`;
  }
  els.deltaNote.replaceChildren(badge, text);
}

function updateFilterUi() {
  const stats = currentStats();
  const threshold = state.filter.threshold;
  const count = MAP_GEOMETRY.buildings.filter(
    (building) => building.temperatures[state.period] >= threshold,
  ).length;

  els.thresholdSlider.min = stats.min;
  els.thresholdSlider.max = stats.max;
  els.thresholdSlider.value = threshold;
  els.thresholdSlider.style.setProperty(
    "--threshold-progress",
    `${((threshold - stats.min) / (stats.max - stats.min)) * 100}%`,
  );
  els.thresholdValue.textContent = format(threshold);
  els.thresholdMin.textContent = `${format(stats.min)}°`;
  els.thresholdMax.textContent = `${format(stats.max)}°`;
  els.filterCount.textContent = String(count);
  els.filterToggle.checked = state.filter.enabled;
  els.filterSummary.lastElementChild.textContent = state.filter.enabled
    ? `已显示 ${count} / ${stats.count} 栋建筑，低值区域已降透明`
    : "开启后低值建筑降透明，橙色点标记热点";
}

function updateSelectionUi() {
  const stats = state.selectionStats;
  if (!stats || stats.count === 0) {
    els.selectionResult.hidden = true;
    els.selectionEmpty.hidden = false;
    els.clearSelectionButton.hidden = !state.selectionRect;
    const title = els.selectionEmpty.querySelector("p");
    const subtitle = els.selectionEmpty.querySelector("small");
    if (state.selectionRect) {
      title.textContent = "框选范围内没有建筑";
      subtitle.textContent = "请拖入建筑屋顶面积后重试";
    } else {
      title.textContent = "在地图上拖动框选建筑";
      subtitle.textContent = "高亮范围将与统计结果保持一致";
    }
    return;
  }

  const consistent = statsConsistencyCheck(stats, state.period);
  els.selectionEmpty.hidden = true;
  els.selectionResult.hidden = false;
  els.clearSelectionButton.hidden = false;
  els.selectionAverage.textContent = format(stats.average);
  els.selectionSwatch.style.background = temperatureHex(stats.average);
  els.selectionCount.textContent = String(stats.count);
  els.selectionArea.textContent = Math.round(stats.area * 4).toLocaleString("zh-CN");
  els.selectionMin.textContent = `${format(stats.min)}°`;
  els.selectionMax.textContent = `${format(stats.max)}°`;
  els.selectionDelta.textContent = `${stats.delta >= 0 ? "+" : ""}${format(stats.delta)}°C`;
  els.selectionDelta.style.color = stats.delta >= 0 ? "#f1a36d" : "#7dd3cf";
  els.selectionDelta.dataset.consistent = String(consistent);

  const mapPosition = clamp((stats.average - 24) / 22, 0, 1) * 100;
  const mapMean = clamp((currentStats().average - 24) / 22, 0, 1) * 100;
  els.spreadFill.style.left = `${mapPosition}%`;
  els.spreadMean.style.left = `${mapMean}%`;
  els.selectionCaption.textContent = `${stats.hottest.name} ${stats.hottest.id} 为框内最高温；白色高亮与统计使用同一建筑集合。`;
  if (!consistent) {
    console.warn("Selection statistics and highlight set diverged.", stats);
  }
}

function updateSelectionStats() {
  if (!state.selectionRect) {
    state.selectionStats = null;
  } else {
    state.selectionStats = calculateSelectionStats(state.selectionRect, state.period);
  }
  updateSelectionUi();
}

function setPeriod(periodKey, announce = true) {
  if (!PERIODS[periodKey]) return;
  const period = PERIODS[periodKey];
  const stats = PERIOD_STATS[periodKey];
  state.period = periodKey;
  state.hoverId = null;
  hideTooltip();
  document.body.dataset.layer = periodKey;

  for (const button of layerButtons) {
    const active = button.dataset.layer === periodKey;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  for (const row of comparisonRows) {
    row.classList.toggle("is-active", row.dataset.layer === periodKey);
  }

  els.periodName.textContent = `${period.label} · ${period.time}`;
  els.periodChip.textContent = period.chip;
  els.heroTemp.textContent = format(stats.average);
  els.rangeMin.textContent = format(stats.min);
  els.rangeMax.textContent = format(stats.max);
  updateDelta(periodKey);

  state.filter.threshold = Math.round(stats.average * 10) / 10;
  updateFilterUi();
  updateSelectionStats();
  updateLayerLabels();
  render();
  if (announce) setMapStatus(`${period.label}图层已载入 · ${period.time}`);
}

function selectArea(rect) {
  const normalized = normalizeRect(
    clamp(rect.x, 0, MAP_GEOMETRY.width),
    clamp(rect.y, 0, MAP_GEOMETRY.height),
    clamp(rect.x + rect.w, 0, MAP_GEOMETRY.width),
    clamp(rect.y + rect.h, 0, MAP_GEOMETRY.height),
  );
  if (normalized.w < 1 || normalized.h < 1) return null;
  state.selectionRect = normalized;
  updateSelectionStats();
  els.mapInstructions.classList.add("is-hidden");
  render();
  return state.selectionStats;
}

function clearSelection() {
  state.selectionRect = null;
  state.selectionStats = null;
  updateSelectionUi();
  els.mapInstructions.classList.remove("is-hidden");
  render();
}

function hideTooltip() {
  tooltip.hidden = true;
  canvas.classList.remove("is-hovering");
}

function showTooltip(building, event) {
  const period = PERIODS[state.period];
  const stats = currentStats();
  const temperature = building.temperatures[state.period];
  const delta = temperature - stats.average;

  els.tooltipBlock.textContent = `${building.name} · ${building.zone}`;
  els.tooltipLayer.textContent = `${period.label} ${period.time}`;
  els.tooltipTemp.textContent = format(temperature);
  els.tooltipBuilding.textContent = `${building.id} · 屋顶 ${building.roofHeight}m`;
  els.tooltipDelta.textContent = `${delta >= 0 ? "+" : ""}${format(delta)}°C`;

  const frameRect = mapFrame.getBoundingClientRect();
  const width = 174;
  let left = event.clientX - frameRect.left + 16;
  let top = event.clientY - frameRect.top - 20;
  if (left + width > frameRect.width - 10) left -= width + 31;
  left = clamp(left, 8, frameRect.width - width - 8);
  top = clamp(top, 8, frameRect.height - 92);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.hidden = false;
  canvas.classList.add("is-hovering");
}

function updateHover(event) {
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  const building = renderer.buildingAt(point.x, point.y);
  const nextHoverId = building?.id || null;
  if (nextHoverId !== state.hoverId) {
    state.hoverId = nextHoverId;
    render();
  }
  if (building) {
    showTooltip(building, event);
  } else {
    hideTooltip();
  }
}

function boundedPoint(event) {
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  return {
    x: clamp(point.x, 0, MAP_GEOMETRY.width),
    y: clamp(point.y, 0, MAP_GEOMETRY.height),
  };
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  canvas.focus();
  hideTooltip();
  dragPointerId = event.pointerId;
  dragStartScreen = { x: event.clientX, y: event.clientY };
  dragStartWorld = boundedPoint(event);
  state.hoverId = null;
  state.dragRect = null;
  canvas.classList.add("is-dragging");
  canvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (dragPointerId === null) {
    updateHover(event);
    return;
  }
  if (event.pointerId !== dragPointerId || !dragStartWorld) return;
  event.preventDefault();
  const end = boundedPoint(event);
  state.dragRect = normalizeRect(dragStartWorld.x, dragStartWorld.y, end.x, end.y);
  if (state.dragRect.w > 1 || state.dragRect.h > 1) {
    els.mapInstructions.classList.add("is-hidden");
  }
  render();
}

function finishPointer(event) {
  if (dragPointerId === null || event.pointerId !== dragPointerId) return;
  const dragRect = state.dragRect;
  const distance = dragStartScreen
    ? Math.hypot(event.clientX - dragStartScreen.x, event.clientY - dragStartScreen.y)
    : 0;
  dragPointerId = null;
  dragStartScreen = null;
  dragStartWorld = null;
  state.dragRect = null;
  canvas.classList.remove("is-dragging");
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }

  if (distance > 5 && dragRect && dragRect.w > 2 && dragRect.h > 2) {
    selectArea(dragRect);
    setMapStatus(`框选完成 · ${state.period === "day" ? "白天" : PERIODS[state.period].label}统计已更新`);
  } else {
    render();
    updateHover(event);
  }
}

function cancelPointer(event) {
  if (dragPointerId === null || event.pointerId !== dragPointerId) return;
  dragPointerId = null;
  dragStartScreen = null;
  dragStartWorld = null;
  state.dragRect = null;
  canvas.classList.remove("is-dragging");
  render();
}

async function exportPng() {
  if (els.exportButton.classList.contains("is-exporting")) return;
  els.exportButton.classList.add("is-exporting");
  els.exportButton.textContent = "正在导出…";
  const previousHover = state.hoverId;
  state.hoverId = null;
  hideTooltip();
  render();

  try {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Canvas export failed");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `梧桐街区-热岛-${PERIODS[state.period].label}-20260814.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
    setMapStatus(`PNG 已导出 · ${PERIODS[state.period].label}图层`, true);
  } catch (error) {
    console.error(error);
    setMapStatus("PNG 导出失败，请重试", true);
  } finally {
    els.exportButton.classList.remove("is-exporting");
    els.exportButton.replaceChildren();
    els.exportButton.insertAdjacentHTML(
      "beforeend",
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V3m0 0-3.5 3.5M10 3l3.5 3.5M4 12v4.5h12V12"/></svg>导出 PNG',
    );
    state.hoverId = previousHover;
    render();
  }
}

layerButtons.forEach((button) => {
  button.addEventListener("click", () => setPeriod(button.dataset.layer));
});
comparisonRows.forEach((button) => {
  button.addEventListener("click", () => setPeriod(button.dataset.layer));
});

els.thresholdSlider.addEventListener("input", () => {
  state.filter.threshold = Number(els.thresholdSlider.value);
  updateFilterUi();
  render();
});

els.filterToggle.addEventListener("change", () => {
  state.filter.enabled = els.filterToggle.checked;
  updateFilterUi();
  render();
});

els.clearSelectionButton.addEventListener("click", clearSelection);
els.exportButton.addEventListener("click", exportPng);

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", cancelPointer);
canvas.addEventListener("pointerleave", () => {
  if (dragPointerId === null) {
    hideTooltip();
    if (state.hoverId !== null) {
      state.hoverId = null;
      render();
    }
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.selectionRect) clearSelection();
});

const resizeObserver = new ResizeObserver(() => {
  renderer.resize();
  render();
});
resizeObserver.observe(mapFrame);

window.heatIslandDebug = {
  setPeriod,
  selectArea,
  clearSelection,
  getPeriodStats: () => PERIOD_STATS,
  getBuildings: () => MAP_GEOMETRY.buildings,
  getState: () => ({
    period: state.period,
    selectionRect: state.selectionRect,
    selectionStats: state.selectionStats,
    filter: { ...state.filter },
    transform: {
      width: renderer.cssWidth,
      height: renderer.cssHeight,
      scale: renderer.scale,
      offsetX: renderer.offsetX,
      offsetY: renderer.offsetY,
    },
    consistency: state.selectionStats
      ? statsConsistencyCheck(state.selectionStats, state.period)
      : null,
  }),
};

document.querySelector(".page-footer > span:nth-child(3)").textContent =
  `内置样本：${MAP_GEOMETRY.buildings.length} 栋建筑 · ${MAP_GEOMETRY.blocks.length} 个街区`;

renderer.resize();
setPeriod("day", false);
render();

document.fonts.ready.then(() => {
  renderer.resize();
  render();
});
