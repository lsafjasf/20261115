import "./styles.css";
import "@fontsource-variable/noto-sans-sc";
import {
  COMPARE_SEED,
  DEFAULT_PARAMS,
  DEFAULT_SEED,
  ROOF_TYPES,
  cityStats,
  describeBuilding,
  generateCity,
  normalizeSeed,
  skylineDistance,
} from "./city.js";
import { CityScene } from "./scene.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  canvas: $("#city-canvas"),
  seedInput: $("#seed-input"),
  seedCaption: $("#seed-caption"),
  randomSeed: $("#random-seed"),
  densityRange: $("#density-range"),
  densityOutput: $("#density-output"),
  variationRange: $("#variation-range"),
  variationOutput: $("#variation-output"),
  roofRange: $("#roof-range"),
  roofOutput: $("#roof-output"),
  roofOptions: $("#roof-options"),
  layerControl: $("#layer-control"),
  layerRange: $("#layer-range"),
  layerOutput: $("#layer-output"),
  layerVisible: $("#layer-visible"),
  layerLegend: $("#layer-legend"),
  selectedEmpty: $("#selected-empty"),
  selectedCard: $("#selected-card"),
  buildingSwatch: $("#building-swatch"),
  buildingName: $("#building-name"),
  buildingMeta: $("#building-meta"),
  buildingFloors: $("#building-floors"),
  buildingHeight: $("#building-height"),
  buildingRoof: $("#building-roof"),
  editStat: $("#edit-stat"),
  viewSeed: $("#view-seed"),
  comparePanel: $("#compare-panel"),
  compareToggle: $("#compare-toggle"),
  compareNote: $("#compare-note"),
  toast: $("#toast"),
  fps: $("#fps-meter"),
  renderStatus: $("#render-status"),
};

const state = {
  params: {
    ...DEFAULT_PARAMS,
    roofTypes: [...DEFAULT_PARAMS.roofTypes],
  },
  slots: {
    a: DEFAULT_SEED,
    b: COMPARE_SEED,
  },
  activeSlot: "a",
  compareCities: { a: null, b: null },
  selectedBuilding: null,
  mode: "solid",
  rebuildTimer: null,
  toastTimer: null,
  autoRotate: false,
  topView: false,
};

const scene = new CityScene(elements.canvas, {
  onSelect: (building) => {
    state.selectedBuilding = building;
    renderSelectedBuilding(building);
  },
  onBuildingChange: (building, meta) => {
    state.selectedBuilding = building;
    renderSelectedBuilding(building);
    syncActiveCompareCity();
    updateCompareVisuals();
    elements.editStat.textContent = `${meta.editRevision} 次单栋更新`;
    elements.layerRange.max = String(Math.max(8, scene.currentCity.maxFloors));
    showToast(`已更新 ${building.id} · 单栋替换，全城重建仍为 ${scene.rebuildCount} 次`);
  },
  onLayerChange: (payload) => {
    renderLayerState(payload);
  },
  onCityReady: (city, stats) => {
    elements.seedCaption.textContent = `${stats.count} 栋建筑 · ${stats.roofCount} 处屋顶设施 · 同一 seed 始终一致`;
    elements.viewSeed.textContent = `SEED ${city.params.seed}`;
    elements.renderStatus.textContent = `WebGL · ${stats.count} 栋 · 增量就绪`;
    elements.layerRange.max = String(Math.max(8, city.maxFloors));
    if (state.mode === "layers") {
      elements.layerOutput.textContent = `${Math.round(scene.layerThreshold)} F`;
    } else {
      elements.layerOutput.textContent = `${city.maxFloors} F`;
      elements.layerRange.value = String(city.maxFloors);
    }
  },
  onFps: (fps) => {
    elements.fps.textContent = `${fps} FPS`;
  },
});

function getRoofTypesFromUI() {
  return $$("#roof-options .roof-chip.is-on").map((button) => button.dataset.roof);
}

function currentSeed() {
  return normalizeSeed(elements.seedInput.value);
}

function syncParamsFromUI() {
  state.params = {
    seed: currentSeed(),
    density: Number(elements.densityRange.value),
    variation: Number(elements.variationRange.value),
    roofDensity: Number(elements.roofRange.value),
    roofTypes: getRoofTypesFromUI(),
  };
  state.slots[state.activeSlot] = state.params.seed;
}

function updateRangeLabels() {
  elements.densityOutput.textContent = `${elements.densityRange.value} × ${elements.densityRange.value}`;
  elements.variationOutput.textContent = `${elements.variationRange.value}%`;
  elements.roofOutput.textContent = `${elements.roofRange.value}%`;
}

function buildMainCity(options = {}) {
  clearTimeout(state.rebuildTimer);
  state.rebuildTimer = null;
  syncParamsFromUI();
  const city = scene.buildCity(state.params);
  state.selectedBuilding = null;
  renderSelectedBuilding(null);
  elements.seedInput.value = city.params.seed;
  elements.viewSeed.textContent = `SEED ${city.params.seed}`;
  elements.editStat.textContent = "0 次单栋更新";
  elements.seedCaption.textContent = `${city.buildings.length} 栋建筑 · ${city.buildings.filter((item) => item.roof !== "none").length} 处屋顶设施 · 同一 seed 始终一致`;
  elements.layerRange.max = String(Math.max(8, city.maxFloors));
  if (options.compare !== false) rebuildComparisonCities();
  if (state.mode === "layers") {
    scene.setLayerMode(true, { animate: options.animateLayers ?? false });
    elements.layerLegend.hidden = false;
  }
  document.title = `Seedscape · ${city.params.seed}`;
  return city;
}

function scheduleBuild() {
  updateRangeLabels();
  syncParamsFromUI();
  clearTimeout(state.rebuildTimer);
  state.rebuildTimer = setTimeout(() => {
    buildMainCity();
  }, 130);
}

function rebuildComparisonCities() {
  for (const slot of ["a", "b"]) {
    state.compareCities[slot] = generateCity({
      ...state.params,
      seed: state.slots[slot],
    });
  }
  updateCompareVisuals();
}

function syncActiveCompareCity() {
  if (scene.currentCity) state.compareCities[state.activeSlot] = scene.currentCity;
}

function drawSilhouette(canvas, city, active) {
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const baseline = height - 17;
  const top = 14;
  const profile = city.profile;
  context.clearRect(0, 0, width, height);

  const backdrop = context.createLinearGradient(0, 0, 0, height);
  backdrop.addColorStop(0, active ? "rgba(216, 255, 117, 0.06)" : "rgba(167, 198, 181, 0.025)");
  backdrop.addColorStop(1, "rgba(7, 18, 19, 0)");
  context.fillStyle = backdrop;
  context.fillRect(0, 0, width, height);

  const color = active ? "216, 255, 117" : "171, 194, 181";
  context.beginPath();
  context.moveTo(0, baseline);
  profile.forEach((value, index) => {
    const x = (index / (profile.length - 1)) * width;
    const y = baseline - value * (baseline - top);
    context.lineTo(x, y);
  });
  context.lineTo(width, baseline);
  context.closePath();
  const fill = context.createLinearGradient(0, top, 0, baseline);
  fill.addColorStop(0, `rgba(${color}, ${active ? 0.19 : 0.09})`);
  fill.addColorStop(1, `rgba(${color}, 0.003)`);
  context.fillStyle = fill;
  context.fill();

  context.beginPath();
  profile.forEach((value, index) => {
    const x = (index / (profile.length - 1)) * width;
    const y = baseline - value * (baseline - top);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = `rgba(${color}, ${active ? 0.9 : 0.46})`;
  context.lineWidth = active ? 1.35 : 1;
  context.stroke();

  context.save();
  context.beginPath();
  context.rect(0, top - 2, width, baseline - top + 2);
  context.clip();
  const sorted = [...city.buildings].sort((first, second) => first.z - second.z);
  for (let index = 0; index < sorted.length; index += 6) {
    const building = sorted[index];
    const x = ((building.x + city.areaWidth / 2) / city.areaWidth) * width;
    const buildingHeight = (building.height / (city.maxFloors * 1.3)) * (baseline - top);
    context.strokeStyle = `rgba(${color}, 0.09)`;
    context.lineWidth = 0.7;
    context.beginPath();
    context.moveTo(x, baseline);
    context.lineTo(x, baseline - buildingHeight);
    context.stroke();
  }
  context.restore();

  context.fillStyle = `rgba(${color}, ${active ? 0.68 : 0.28})`;
  context.fillRect(0, baseline, width, 1);
  context.fillStyle = "rgba(159, 181, 169, 0.25)";
  for (let x = 12; x < width; x += 28) context.fillRect(x, baseline + 7, 1, 3);
}

function updateCompareVisuals() {
  const { a, b } = state.compareCities;
  if (!a || !b) return;
  const statsA = cityStats(a);
  const statsB = cityStats(b);
  drawSilhouette($("#silhouette-a"), a, state.activeSlot === "a");
  drawSilhouette($("#silhouette-b"), b, state.activeSlot === "b");
  $("#seed-a-number").textContent = state.slots.a;
  $("#seed-b-number").textContent = state.slots.b;
  $("#seed-a-count").textContent = statsA.count;
  $("#seed-b-count").textContent = statsB.count;
  $("#seed-a-peak").textContent = statsA.maxFloors;
  $("#seed-b-peak").textContent = statsB.maxFloors;
  $("#seed-a-density").textContent = a.density;
  $("#seed-b-density").textContent = b.density;
  $("#seed-card-a").classList.toggle("is-active", state.activeSlot === "a");
  $("#seed-card-b").classList.toggle("is-active", state.activeSlot === "b");
  const distance = skylineDistance(a.profile, b.profile);
  const taller = statsA.maxFloors === statsB.maxFloors ? "峰值相同" : statsA.maxFloors > statsB.maxFloors ? "A 更高" : "B 更高";
  elements.compareNote.textContent = `轮廓差 ${distance.toFixed(3)} · ${taller}`;
}

function renderSelectedBuilding(building) {
  elements.selectedEmpty.hidden = Boolean(building);
  elements.selectedCard.hidden = !building;
  if (!building) return;
  elements.buildingName.textContent = building.id;
  elements.buildingMeta.textContent = `${describeBuilding(building)} · ${building.styleLabel}`;
  elements.buildingSwatch.style.background = building.color;
  elements.buildingFloors.textContent = building.floors;
  elements.buildingHeight.textContent = `${Math.round(building.floors * 3.2)}m`;
  elements.buildingRoof.textContent = building.roofLabel;
  requestAnimationFrame(() => {
    elements.selectedCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function renderLayerState(payload) {
  if (!payload) return;
  if (!payload.enabled) {
    elements.layerOutput.textContent = `${payload.max ?? 64} F`;
    elements.layerVisible.textContent = "全部建筑可见";
    elements.layerRange.value = String(payload.max ?? 64);
    return;
  }
  const threshold = Math.round(Number(payload.threshold ?? 0));
  elements.layerOutput.textContent = `${threshold} F`;
  elements.layerVisible.textContent = `${payload.visible} / ${payload.total} 栋可见`;
  elements.layerRange.value = String(Math.min(Number(elements.layerRange.max), threshold));
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2200);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function saveParameters() {
  syncParamsFromUI();
  const payload = {
    format: "seedscape-city-v1",
    savedAt: new Date().toISOString(),
    activeSlot: state.activeSlot,
    seeds: { ...state.slots },
    parameters: { ...state.params },
    view: scene.getCameraState(),
    displayMode: state.mode,
    layerThreshold: Math.round(scene.layerThreshold),
  };
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `seedscape-${state.params.seed}.json`,
  );
  showToast("参数 JSON 已保存");
}

function saveScreenshot() {
  const city = scene.currentCity;
  if (!city) return;
  const dataUrl = scene.getScreenshotDataURL({
    seed: city.params.seed,
    buildings: city.buildings.length,
    maxFloors: city.maxFloors,
  });
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = `seedscape-${city.params.seed}-${Date.now()}.png`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  showToast("当前城市截图已保存");
}

function randomSeed() {
  const value = String(Math.floor(10000000 + Math.random() * 89999999));
  elements.seedInput.value = value;
  state.slots[state.activeSlot] = value;
  buildMainCity();
  showToast(`Seed ${value} 已生成`);
}

function setActiveSlot(slot) {
  const slotSeed = state.slots[slot];
  state.activeSlot = slot;
  elements.seedInput.value = slotSeed;
  state.compareCities[slot] = generateCity({ ...state.params, seed: slotSeed });
  buildMainCity();
}

function activateMode(mode, options = {}) {
  state.mode = mode;
  $$(".segment").forEach((segment) => segment.classList.toggle("is-active", segment.dataset.mode === mode));
  const layerEnabled = mode === "layers";
  elements.layerControl.classList.toggle("is-muted", !layerEnabled);
  elements.layerLegend.hidden = !layerEnabled;
  scene.setLayerMode(layerEnabled, {
    animate: options.animate ?? layerEnabled,
    value: Number(elements.layerRange.value),
  });
  if (layerEnabled) {
    showToast("逐层显影：低层先出现，塔楼随层级升高");
  }
}

function updateSelectedFloors(delta) {
  const building = state.selectedBuilding;
  if (!building) return;
  const updated = scene.updateBuilding(building.id, { floors: building.floors + delta });
  if (updated) state.selectedBuilding = updated;
}

function cycleRoof() {
  const building = state.selectedBuilding;
  if (!building) return;
  const allowed = ["none", ...ROOF_TYPES.filter((type) => state.params.roofTypes.includes(type))];
  const index = allowed.indexOf(building.roof);
  const next = allowed[(index + 1) % allowed.length];
  const updated = scene.updateBuilding(building.id, { roof: next });
  if (updated) state.selectedBuilding = updated;
}

function resetAll() {
  state.params = { ...DEFAULT_PARAMS, roofTypes: [...DEFAULT_PARAMS.roofTypes] };
  state.slots = { a: DEFAULT_SEED, b: COMPARE_SEED };
  state.activeSlot = "a";
  elements.seedInput.value = DEFAULT_SEED;
  elements.densityRange.value = String(DEFAULT_PARAMS.density);
  elements.variationRange.value = String(DEFAULT_PARAMS.variation);
  elements.roofRange.value = String(DEFAULT_PARAMS.roofDensity);
  $$("#roof-options .roof-chip").forEach((button) => {
    const enabled = DEFAULT_PARAMS.roofTypes.includes(button.dataset.roof);
    button.classList.toggle("is-on", enabled);
    button.setAttribute("aria-pressed", String(enabled));
  });
  activateMode("solid", { animate: false });
  state.topView = false;
  $("#top-view").classList.remove("is-active");
  scene.resetCamera();
  buildMainCity();
  updateRangeLabels();
  showToast("已恢复默认参数");
}

function toggleHold(id) {
  const button = document.getElementById(id);
  const next = !button.classList.contains("is-active");
  button.classList.toggle("is-active", next);
  button.setAttribute("aria-pressed", String(next));
  return next;
}

function bindUI() {
  elements.seedInput.addEventListener("input", () => {
    const cleaned = elements.seedInput.value.replace(/[^\d]/g, "").slice(0, 12);
    if (cleaned !== elements.seedInput.value) elements.seedInput.value = cleaned;
    state.slots[state.activeSlot] = cleaned || DEFAULT_SEED;
    scheduleBuild();
  });
  elements.seedInput.addEventListener("change", () => {
    elements.seedInput.value = currentSeed();
    buildMainCity();
  });
  elements.seedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") buildMainCity();
  });
  elements.randomSeed.addEventListener("click", randomSeed);

  elements.densityRange.addEventListener("input", scheduleBuild);
  elements.variationRange.addEventListener("input", scheduleBuild);
  elements.roofRange.addEventListener("input", scheduleBuild);

  elements.roofOptions.addEventListener("click", (event) => {
    const button = event.target.closest(".roof-chip");
    if (!button) return;
    const enabled = !button.classList.contains("is-on");
    button.classList.toggle("is-on", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    state.params.roofTypes = getRoofTypesFromUI();
    scheduleBuild();
  });

  $$(".segment").forEach((segment) => {
    segment.addEventListener("click", () => activateMode(segment.dataset.mode));
  });
  elements.layerRange.addEventListener("input", () => {
    if (state.mode !== "layers") return;
    scene.setLayerThreshold(Number(elements.layerRange.value));
  });

  $("#floor-minus").addEventListener("click", () => updateSelectedFloors(-2));
  $("#floor-plus").addEventListener("click", () => updateSelectedFloors(2));
  $("#roof-cycle").addEventListener("click", cycleRoof);

  $("#save-btn").addEventListener("click", saveParameters);
  $("#shot-btn").addEventListener("click", saveScreenshot);
  $("#reset-btn").addEventListener("click", resetAll);
  $("#reset-camera").addEventListener("click", () => {
    scene.resetCamera();
    state.topView = false;
    $("#top-view").classList.remove("is-active");
    showToast("视角已复位");
  });
  $("#auto-rotate").addEventListener("click", () => {
    state.autoRotate = toggleHold("auto-rotate");
    scene.setAutoRotate(state.autoRotate);
  });
  $("#top-view").addEventListener("click", () => {
    state.topView = toggleHold("top-view");
    if (state.topView) scene.setTopView();
    else scene.resetCamera();
  });

  $("#seed-card-a").addEventListener("click", () => setActiveSlot("a"));
  $("#seed-card-b").addEventListener("click", () => setActiveSlot("b"));
  $("#compare-refresh").addEventListener("click", () => {
    syncParamsFromUI();
    rebuildComparisonCities();
    showToast("双 seed 轮廓已用当前参数重算");
  });
  elements.compareToggle.addEventListener("click", () => {
    const collapsed = elements.comparePanel.classList.toggle("is-collapsed");
    elements.compareToggle.textContent = collapsed ? "+" : "−";
    elements.compareToggle.setAttribute("aria-expanded", String(!collapsed));
  });

  $("#help-button").addEventListener("click", () => {
    $("#help-modal").hidden = false;
  });
  $$("[data-close-help]").forEach((button) => {
    button.addEventListener("click", () => {
      $("#help-modal").hidden = true;
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") $("#help-modal").hidden = true;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveParameters();
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveScreenshot();
    }
  });
}

function meshFingerprints() {
  const fingerprints = {};
  for (const [id, group] of scene.buildingGroups) {
    const tiers = group.children.filter((child) => child.isMesh);
    fingerprints[id] = tiers.map((mesh) => mesh.uuid).join("|");
  }
  return fingerprints;
}

function getCompareState() {
  const { a, b } = state.compareCities;
  if (!a || !b) return null;
  return {
    a: { seed: a.params.seed, ...cityStats(a) },
    b: { seed: b.params.seed, ...cityStats(b) },
    distance: skylineDistance(a.profile, b.profile),
    activeSlot: state.activeSlot,
  };
}

function applyDebugParams(patch) {
  const next = { ...state.params, ...patch };
  state.params = next;
  state.slots[state.activeSlot] = normalizeSeed(next.seed);
  elements.seedInput.value = state.slots[state.activeSlot];
  if (patch.density !== undefined) elements.densityRange.value = String(patch.density);
  if (patch.variation !== undefined) elements.variationRange.value = String(patch.variation);
  if (patch.roofDensity !== undefined) elements.roofRange.value = String(patch.roofDensity);
  if (patch.roofTypes) {
    $$("#roof-options .roof-chip").forEach((button) => {
      const enabled = patch.roofTypes.includes(button.dataset.roof);
      button.classList.toggle("is-on", enabled);
      button.setAttribute("aria-pressed", String(enabled));
    });
  }
  updateRangeLabels();
  return buildMainCity();
}

window.__CITY_LAB__ = {
  scene,
  state,
  getState: () => scene.getState(),
  getCompareState,
  meshFingerprints,
  setParams: applyDebugParams,
  setSeed: (seed, slot = state.activeSlot) => {
    state.activeSlot = slot;
    state.slots[slot] = normalizeSeed(seed);
    elements.seedInput.value = state.slots[slot];
    return buildMainCity();
  },
  setLayerMode: (mode, options = {}) => activateMode(mode, options),
  setLayerThreshold: (value) => {
    activateMode("layers", { animate: false });
    scene.setLayerThreshold(value);
  },
  orbitTo: (azimuth, elevation, distance) => {
    scene.orbitTo(azimuth, elevation, distance);
    return scene.getCameraState();
  },
  findOcclusionProbe: () => scene.findOcclusionProbe(),
  findClickableBuilding: () => scene.findClickableBuilding(),
  updateBuilding: (id, patch) => scene.updateBuilding(id, patch),
  selectBuilding: (id) => {
    scene.selectBuilding(id);
    state.selectedBuilding = scene.currentCity.buildings.find((building) => building.id === id) ?? null;
    renderSelectedBuilding(state.selectedBuilding);
    return state.selectedBuilding;
  },
  screenshotDataUrl: () => scene.getScreenshotDataURL(),
  saveParameters: () => saveParameters(),
};

bindUI();
updateRangeLabels();
buildMainCity({ animateLayers: false });
window.setTimeout(() => showToast("拖拽旋转 · 点击楼体进行单栋编辑"), 900);
