import "./styles.css";
import { TerrainScene } from "./scene.js";
import {
  DEFAULT_GRID,
  analyzeTerrain,
  generateTerrain,
  gridToWorld,
  HEIGHT_SCALE,
  normalizeParams,
  sampleHeight,
} from "./terrain.js";
import { exportTerrainJson, exportTerrainPng, buildExportPayload } from "./exporter.js";
import { renderComparison, runSeedComparison } from "./compare.js";

const scene = new TerrainScene(document.getElementById("terrain-canvas"));
const elements = {
  seed: document.getElementById("seed"),
  frequency: document.getElementById("frequency"),
  octaves: document.getElementById("octaves"),
  erosion: document.getElementById("erosion"),
  seaLevel: document.getElementById("sea-level"),
  frequencyValue: document.getElementById("frequency-value"),
  octavesValue: document.getElementById("octaves-value"),
  erosionValue: document.getElementById("erosion-value"),
  seaLevelValue: document.getElementById("sea-level-value"),
  peak: document.getElementById("peak-value"),
  peakCoord: document.getElementById("peak-coord"),
  land: document.getElementById("land-value"),
  landPercent: document.getElementById("land-percent"),
  water: document.getElementById("water-value"),
  caveStat: document.getElementById("cave-stat-value"),
  flagWaterStatus: document.getElementById("flag-water-status"),
  flagCount: document.getElementById("flag-count"),
  flagList: document.getElementById("flag-list"),
  flagsEmpty: document.getElementById("flags-empty"),
  clearFlags: document.getElementById("clear-flags"),
  buildTime: document.getElementById("build-time"),
  mapSeed: document.getElementById("map-seed"),
  toastRegion: document.getElementById("toast-region"),
  compareDialog: document.getElementById("compare-dialog"),
  compareSeedA: document.getElementById("compare-seed-a"),
  compareSeedB: document.getElementById("compare-seed-b"),
  runCompare: document.getElementById("run-compare"),
};

const state = {
  params: normalizeParams({
    seed: elements.seed.value,
    frequency: elements.frequency.value,
    octaves: elements.octaves.value,
    erosion: elements.erosion.value,
    seaLevel: elements.seaLevel.value,
  }),
  terrain: null,
  stats: null,
  flags: [],
  comparison: null,
  pendingFrame: 0,
};

function formatCoordinate(value) {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}`;
}

function setRangeProgress(input) {
  const progress = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
  input.style.setProperty("--progress", `${progress}%`);
}

function refreshControlLabels() {
  const seaElevation = Math.round(Number(elements.seaLevel.value) * HEIGHT_SCALE);
  elements.frequencyValue.textContent = Number(elements.frequency.value).toFixed(2);
  elements.octavesValue.textContent = `${elements.octaves.value} 层`;
  elements.erosionValue.textContent = `${Math.round(Number(elements.erosion.value) * 100)}%`;
  elements.seaLevelValue.textContent = `${seaElevation} m`;
  [
    elements.frequency,
    elements.octaves,
    elements.erosion,
    elements.seaLevel,
  ].forEach(setRangeProgress);
}

function toast(message, variant = "") {
  const node = document.createElement("div");
  node.className = `toast ${variant}`.trim();
  node.textContent = message;
  elements.toastRegion.append(node);
  window.setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateY(5px)";
    node.style.transition = "opacity 180ms ease, transform 180ms ease";
    window.setTimeout(() => node.remove(), 200);
  }, 2300);
}

function flagStatus(flag) {
  return flag.world.y < state.stats.waterElevation ? "水下" : "陆地";
}

function renderFlagList() {
  const submergedCount = state.flags.filter((flag) => flagStatus(flag) === "水下").length;
  elements.flagCount.textContent = String(state.flags.length);
  elements.caveStat.textContent = String(state.flags.length);
  elements.clearFlags.disabled = state.flags.length === 0;
  elements.flagsEmpty.hidden = state.flags.length > 0;
  if (state.flags.length === 0) {
    elements.flagWaterStatus.textContent = "右键地形插旗";
  } else if (submergedCount > 0) {
    elements.flagWaterStatus.textContent = `${submergedCount} 处位于水线以下`;
  } else {
    elements.flagWaterStatus.textContent = "全部入口位于水面以上";
  }
  elements.flagList.replaceChildren(...state.flags.map((flag) => {
    const item = document.createElement("li");
    item.className = `flag-item${flagStatus(flag) === "水下" ? " submerged" : ""}`;
    item.dataset.flagId = flag.id;
    const currentGround = sampleHeight(
      state.terrain.heights,
      state.terrain.grid,
      flag.world.x,
      flag.world.z,
    ) * HEIGHT_SCALE;
    item.title = `入口世界坐标固定；当前正下方地面 ${Math.round(currentGround)} m`;

    const dot = document.createElement("span");
    dot.className = "flag-dot";
    const copy = document.createElement("span");
    copy.className = "flag-copy";
    const name = document.createElement("strong");
    name.textContent = flag.name;
    const coordinate = document.createElement("small");
    coordinate.textContent = `X ${formatCoordinate(flag.world.x)} · Y ${Math.round(flag.world.y)} · Z ${formatCoordinate(flag.world.z)} m`;
    copy.append(name, coordinate);
    const status = document.createElement("span");
    status.className = "flag-status";
    status.textContent = flagStatus(flag);
    const remove = document.createElement("button");
    remove.className = "flag-remove";
    remove.type = "button";
    remove.title = "删除旗标";
    remove.setAttribute("aria-label", `删除 ${flag.name}`);
    remove.dataset.removeFlag = flag.id;
    remove.textContent = "×";
    item.append(dot, copy, status, remove);
    return item;
  }));
  scene.syncFlags(state.flags, state.stats.waterElevation);
}

function updateStats() {
  const { stats, params } = state;
  const peakWorld = gridToWorld(
    state.terrain.heights,
    state.terrain.grid,
    stats.highestX,
    stats.highestZ,
  );
  elements.peak.textContent = String(Math.round(stats.peakElevation));
  elements.peakCoord.textContent = `X ${formatCoordinate(peakWorld.x)} · Z ${formatCoordinate(peakWorld.z)}`;
  elements.land.textContent = stats.landAreaKm2.toFixed(2);
  elements.landPercent.textContent = `${stats.landPercent.toFixed(1)}% · 共 ${(stats.grid * stats.grid).toLocaleString()} 个采样单元`;
  elements.water.textContent = String(Math.round(stats.waterElevation));
  elements.mapSeed.textContent = params.seed.toUpperCase();
  elements.buildTime.textContent = `${state.buildMs?.toFixed(1) ?? "—"} ms`;
  renderFlagList();
}

function readParamsFromControls() {
  return normalizeParams({
    seed: elements.seed.value,
    frequency: elements.frequency.value,
    octaves: elements.octaves.value,
    erosion: elements.erosion.value,
    seaLevel: elements.seaLevel.value,
  });
}

function regenerateTerrain() {
  state.pendingFrame = 0;
  const params = readParamsFromControls();
  const started = performance.now();
  const terrain = generateTerrain(params, DEFAULT_GRID);
  const stats = analyzeTerrain(terrain.heights, terrain.grid, params.seaLevel);
  state.params = params;
  state.terrain = terrain;
  state.stats = stats;
  state.buildMs = performance.now() - started;
  scene.setTerrain(terrain.heights, terrain.grid, params.seaLevel);
  updateStats();
  document.title = `${params.seed} — Terrain Lab`;
}

function scheduleTerrainUpdate() {
  refreshControlLabels();
  if (state.pendingFrame) return;
  state.pendingFrame = requestAnimationFrame(regenerateTerrain);
}

function updateWaterLevel() {
  refreshControlLabels();
  const seaLevel = Number(elements.seaLevel.value);
  state.params.seaLevel = seaLevel;
  state.stats = analyzeTerrain(state.terrain.heights, state.terrain.grid, seaLevel);
  scene.updateGeometry(seaLevel);
  updateStats();
}

function randomSeed() {
  const first = ["ember", "moss", "tidal", "granite", "hollow", "pale", "drift", "cedar"];
  const second = ["ridge", "basin", "harbor", "delta", "canyon", "fen", "atoll", "reach"];
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return `${first[bytes[0] % first.length]}-${second[bytes[1] % second.length]}-${String(bytes[0]).padStart(2, "0")}`;
}

function applySeed(seed) {
  elements.seed.value = seed;
  scheduleTerrainUpdate();
}

function addFlagAt(point) {
  const number = String(state.flags.length + 1).padStart(2, "0");
  const flag = {
    id: crypto.randomUUID?.() ?? `flag-${Date.now()}-${number}`,
    name: `洞穴 ${number}`,
    world: {
      x: Number(point.x.toFixed(3)),
      y: Number(point.y.toFixed(3)),
      z: Number(point.z.toFixed(3)),
    },
    createdAt: new Date().toISOString(),
  };
  state.flags.push(flag);
  renderFlagList();
  toast(`${flag.name} 已标记 · 世界坐标已锁定`);
}

function removeFlag(id) {
  const flag = state.flags.find((item) => item.id === id);
  state.flags = state.flags.filter((item) => item.id !== id);
  renderFlagList();
  if (flag) toast(`${flag.name} 已移除`);
}

function setCompareBusy(busy) {
  elements.runCompare.disabled = busy;
  elements.runCompare.textContent = busy ? "计算地形场…" : "运行对比";
}

function performComparison() {
  setCompareBusy(true);
  window.setTimeout(() => {
    try {
      const seedA = elements.compareSeedA.value.trim() || state.params.seed;
      const seedB = elements.compareSeedB.value.trim() || "tidal-ridge";
      state.comparison = runSeedComparison(seedA, seedB, state.params);
      renderComparison(state.comparison);
    } finally {
      setCompareBusy(false);
    }
  }, 30);
}

function openComparison() {
  elements.compareSeedA.value = state.params.seed;
  if (elements.compareSeedB.value === state.params.seed || !elements.compareSeedB.value.trim()) {
    elements.compareSeedB.value = state.params.seed === "tidal-ridge" ? "mist-07" : "tidal-ridge";
  }
  elements.compareDialog.showModal();
  performComparison();
}

function exportCurrentPng() {
  scene.renderNow();
  const payload = buildExportPayload({
    params: { ...state.params },
    stats: { ...state.stats },
    flags: structuredClone(state.flags),
    title: `地貌 ${state.params.seed}`,
  });
  exportTerrainPng(scene.renderer.domElement, payload)
    .then(() => toast("PNG 地图已导出"))
    .catch(() => toast("PNG 导出失败，请重试", "danger"));
}

function exportCurrentJson() {
  const payload = buildExportPayload({
    params: { ...state.params },
    stats: { ...state.stats },
    flags: structuredClone(state.flags),
    title: `地貌 ${state.params.seed}`,
  });
  exportTerrainJson(payload);
  toast("参数与旗标 JSON 已导出");
}

elements.frequency.addEventListener("input", scheduleTerrainUpdate);
elements.octaves.addEventListener("input", scheduleTerrainUpdate);
elements.erosion.addEventListener("input", scheduleTerrainUpdate);
elements.seaLevel.addEventListener("input", updateWaterLevel);
elements.seed.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    scheduleTerrainUpdate();
  }
});
document.getElementById("apply-seed").addEventListener("click", scheduleTerrainUpdate);
document.getElementById("random-seed").addEventListener("click", () => {
  applySeed(randomSeed());
  toast("已生成新的地貌种子");
});
document.getElementById("reset-view").addEventListener("click", () => scene.resetView());
document.getElementById("clear-flags").addEventListener("click", () => {
  if (state.flags.length === 0) return;
  state.flags = [];
  renderFlagList();
  toast("全部洞穴旗标已清空");
});
elements.flagList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-flag]");
  if (button) removeFlag(button.dataset.removeFlag);
});
document.getElementById("export-png").addEventListener("click", exportCurrentPng);
document.getElementById("export-json").addEventListener("click", exportCurrentJson);
document.getElementById("open-compare").addEventListener("click", openComparison);
elements.runCompare.addEventListener("click", performComparison);
elements.compareSeedA.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    performComparison();
  }
});
elements.compareSeedB.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    performComparison();
  }
});
document.getElementById("use-seed-a").addEventListener("click", () => {
  applySeed(elements.compareSeedA.value.trim() || state.params.seed);
  elements.compareDialog.close();
  toast("已应用 Seed A");
});
document.getElementById("use-seed-b").addEventListener("click", () => {
  applySeed(elements.compareSeedB.value.trim() || "tidal-ridge");
  elements.compareDialog.close();
  toast("已应用 Seed B");
});
elements.compareDialog.addEventListener("click", (event) => {
  if (event.target === elements.compareDialog) elements.compareDialog.close();
});

scene.onFlagPlace = addFlagAt;
elements.compareSeedB.value = "tidal-ridge";
refreshControlLabels();
regenerateTerrain();
