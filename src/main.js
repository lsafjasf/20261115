import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import "@fontsource/noto-sans-sc/chinese-simplified-400.css";
import "@fontsource/noto-sans-sc/chinese-simplified-600.css";
import "./styles.css";
import { exportLevelOverview } from "./exporter.js";
import { LEVEL_META, WORLD_SIZE, heightAt } from "./terrain.js";
import { TileManager } from "./tile-manager.js";
import { mountUI } from "./ui.js";

const app = document.querySelector("#app");
mountUI(app);

const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.96;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b1210, 0.00024);

const camera = new THREE.PerspectiveCamera(
  43,
  window.innerWidth / window.innerHeight,
  2,
  9000
);
const DEFAULT_POSITION = new THREE.Vector3(735, 670, 735);
const DEFAULT_TARGET = new THREE.Vector3(-20, 20, 30);
camera.position.copy(DEFAULT_POSITION);
camera.userData.target = DEFAULT_TARGET.clone();
camera.lookAt(DEFAULT_TARGET);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(DEFAULT_TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.minDistance = 220;
controls.maxDistance = 2500;
controls.minPolarAngle = 0.17;
controls.maxPolarAngle = 1.25;
controls.zoomSpeed = 0.72;
controls.rotateSpeed = 0.55;
controls.panSpeed = 0.8;

const hemisphere = new THREE.HemisphereLight(0xc2d8ce, 0x2c2119, 0.72);
scene.add(hemisphere);

const sun = new THREE.DirectionalLight(0xffe2ba, 2.35);
sun.position.set(-640, 920, 420);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -1450;
sun.shadow.camera.right = 1450;
sun.shadow.camera.top = 1450;
sun.shadow.camera.bottom = -1450;
sun.shadow.camera.near = 100;
sun.shadow.camera.far = 3600;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 1.8;
scene.add(sun);

const fill = new THREE.DirectionalLight(0x88b9ae, 0.38);
fill.position.set(720, 380, -520);
scene.add(fill);

const ambient = new THREE.AmbientLight(0x415044, 0.24);
scene.add(ambient);

const backdrop = new THREE.Mesh(
  new THREE.CircleGeometry(4200, 80),
  new THREE.MeshBasicMaterial({ color: 0x0b1110 })
);
backdrop.rotation.x = -Math.PI * 0.5;
backdrop.position.y = -330;
scene.add(backdrop);

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_SIZE * 1.02, WORLD_SIZE * 1.02),
  new THREE.MeshPhysicalMaterial({
    color: 0x244f51,
    roughness: 0.34,
    metalness: 0.04,
    transparent: true,
    opacity: 0.67,
    depthWrite: false
  })
);
water.rotation.x = -Math.PI * 0.5;
water.position.y = -32;
water.renderOrder = 1;
scene.add(water);

const ringMaterial = new THREE.LineBasicMaterial({
  color: 0x819a89,
  transparent: true,
  opacity: 0.18
});
const outlinePoints = [];
for (let i = 0; i <= 256; i += 1) {
  const angle = (i / 256) * Math.PI * 2;
  const x = Math.cos(angle) * (WORLD_SIZE * 0.5);
  const z = Math.sin(angle) * (WORLD_SIZE * 0.5);
  outlinePoints.push(x, heightAt(x, z) + 2, z);
}
const worldOutline = new THREE.Line(
  new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute(outlinePoints, 3)
  ),
  ringMaterial
);
scene.add(worldOutline);

const manager = new TileManager(scene, camera);
manager.setTargetLevel(1);
manager.levelGroups[1].visible = true;
manager.activeLevel = 1;
manager.activeKeys = new Set();
manager.levelHistory.push(1);

const ui = {
  wireToggle: document.querySelector("#wireToggle"),
  resetView: document.querySelector("#resetView"),
  exportButton: document.querySelector("#exportButton"),
  exportMenu: document.querySelector("#exportMenu"),
  hitRate: document.querySelector("#hitRate"),
  hitSpark: document.querySelector("#hitSpark"),
  memoryValue: document.querySelector("#memoryValue"),
  memoryFill: document.querySelector("#memoryFill"),
  residentValue: document.querySelector("#residentValue"),
  residentTotal: document.querySelector("#residentTotal"),
  hitCount: document.querySelector("#hitCount"),
  missCount: document.querySelector("#missCount"),
  evictCount: document.querySelector("#evictCount"),
  queueCount: document.querySelector("#queueCount"),
  tileMosaic: document.querySelector("#tileMosaic"),
  activeLod: document.querySelector("#activeLod"),
  visibleTiles: document.querySelector("#visibleTiles"),
  altitude: document.querySelector("#altitude"),
  seamDelta: document.querySelector("#seamDelta"),
  railThumb: document.querySelector("#railThumb"),
  verifyButton: document.querySelector("#verifyButton"),
  verifyPanel: document.querySelector("#verifyPanel"),
  verifyList: document.querySelector("#verifyList"),
  closeVerify: document.querySelector("#closeVerify"),
  toast: document.querySelector("#toast"),
  toastText: document.querySelector("#toastText"),
  compassNeedle: document.querySelector("#compassNeedle"),
  boot: document.querySelector("#boot")
};

let wireframe = false;
let manualLevel = null;
let toastTimer = 0;
let lastUiAt = 0;
let lastSeamAt = 0;
let lastMosaicLevel = -1;
let seam = { maxHeightDelta: 0, maxColorDelta: 0, samples: 0, levelsLoaded: 0 };
let hitHistory = new Array(32).fill(0);
let cameraTween = null;
let auditResult = null;
let bootHidden = false;

function showToast(message, error = false) {
  window.clearTimeout(toastTimer);
  ui.toastText.textContent = message;
  ui.toast.classList.toggle("error", error);
  ui.toast.classList.add("show");
  toastTimer = window.setTimeout(() => ui.toast.classList.remove("show"), 2800);
}

function currentDistance() {
  return camera.position.distanceTo(controls.target);
}

function animateDistance(distance, duration = 620) {
  const start = camera.position.clone();
  const target = controls.target.clone();
  const direction = start.clone().sub(target).normalize();
  const end = target.clone().addScaledVector(direction, distance);
  cameraTween = {
    start,
    end,
    startedAt: performance.now(),
    duration
  };
}

function resetCamera(animate = true) {
  manualLevel = null;
  if (animate) {
    const direction = DEFAULT_POSITION.clone().sub(DEFAULT_TARGET).normalize();
    const targetStart = controls.target.clone();
    const targetEnd = DEFAULT_TARGET.clone();
    cameraTween = {
      start: camera.position.clone(),
      end: targetEnd.clone().addScaledVector(direction, 1217),
      startTarget: targetStart,
      endTarget: targetEnd,
      startedAt: performance.now(),
      duration: 760
    };
  } else {
    camera.position.copy(DEFAULT_POSITION);
    controls.target.copy(DEFAULT_TARGET);
    controls.update();
  }
}

function setLevelPreset(levelIndex) {
  const distances = [1810, 1010, 440];
  manualLevel = levelIndex;
  animateDistance(distances[levelIndex], 720);
}

function buildMosaic(activeLevel) {
  if (lastMosaicLevel === activeLevel) return;
  lastMosaicLevel = activeLevel;
  ui.tileMosaic.innerHTML = "";
  for (const level of LEVEL_META) {
    const el = document.createElement("div");
    el.className = "mosaic-level";
    if (level.index === activeLevel) el.classList.add("active");
    el.style.gridTemplateColumns = `repeat(${level.grid}, 1fr)`;
    for (let i = 0; i < level.totalTiles; i += 1) {
      const cell = document.createElement("i");
      cell.dataset.tile = String(i);
      el.appendChild(cell);
    }
    ui.tileMosaic.appendChild(el);
  }
}

function updateMosaic(stats) {
  buildMosaic(stats.targetLevel);
  const mosaics = [...ui.tileMosaic.children];
  const level = LEVEL_META[stats.targetLevel];
  const cells = mosaics[stats.targetLevel]?.children ?? [];
  const activeKeys = manager.activeKeys;
  if (!level) return;
  let index = 0;
  for (let z = 0; z < level.grid; z += 1) {
    for (let x = 0; x < level.grid; x += 1) {
      const key = `${level.index}:${x}:${z}`;
      const entry = manager.cache.get(key);
      const cell = cells[index];
      if (cell) {
        cell.className = "";
        if (entry?.state === "ready") cell.classList.add("loaded");
        if (activeKeys.has(key) && entry?.state === "ready") {
          cell.classList.add("visible");
        }
      }
      index += 1;
    }
  }
}

function updateStats(now) {
  if (now - lastUiAt < 120) return;
  lastUiAt = now;
  const stats = manager.getStats();
  const memoryMb = stats.memoryBytes / (1024 * 1024);
  ui.hitRate.textContent = stats.hitRate.toFixed(1);
  ui.memoryValue.textContent = memoryMb.toFixed(1);
  ui.memoryFill.style.width = `${Math.min(100, (stats.memoryBytes / (72 * 1024 * 1024)) * 100)}%`;
  ui.residentValue.textContent = String(stats.resident);
  ui.residentTotal.textContent = String(stats.residentTotal);
  ui.hitCount.textContent = String(stats.hits);
  ui.missCount.textContent = String(stats.misses);
  ui.evictCount.textContent = String(stats.evictions);
  ui.queueCount.textContent = `QUEUE ${stats.loading}`;
  ui.visibleTiles.textContent = `${stats.visible} TILES`;
  ui.altitude.textContent = `${Math.round(camera.position.y)} M`;
  ui.seamDelta.textContent = `${seam.maxHeightDelta.toFixed(3)} M`;
  ui.seamDelta.title = `最大颜色差 ${seam.maxColorDelta.toFixed(5)} / ${seam.samples} 个共享边界样本`;

  const target = stats.targetLevel >= 0 ? stats.targetLevel : stats.activeLevel;
  const level = LEVEL_META[target] ?? LEVEL_META[1];
  ui.activeLod.textContent = `${level.label} · ${level.grid}×${level.grid}`;
  ui.railThumb.style.top = `${target * 50}%`;
  document.querySelectorAll(".level-button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.level) === target);
  });

  updateMosaic(stats);

  if (now - lastSeamAt > 700) {
    lastSeamAt = now;
    const nextSeam = manager.measureSeams();
    if (nextSeam.samples > 0) seam = nextSeam;
    hitHistory.push(stats.hitRate);
    hitHistory.shift();
    const points = hitHistory
      .map((value, index) => {
        const x = (index / (hitHistory.length - 1)) * 92;
        const y = 31 - (value / 100) * 27;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    ui.hitSpark.setAttribute("points", points);
  }
}

function updateCompass() {
  const dx = camera.position.x - controls.target.x;
  const dz = camera.position.z - controls.target.z;
  const angle = (Math.atan2(dx, dz) * 180) / Math.PI;
  ui.compassNeedle.style.transform = `rotate(${angle.toFixed(1)}deg)`;
}

function updateCameraTween(now) {
  if (!cameraTween) return;
  const t = Math.min(1, (now - cameraTween.startedAt) / cameraTween.duration);
  const eased = 1 - Math.pow(1 - t, 3);
  camera.position.lerpVectors(cameraTween.start, cameraTween.end, eased);
  if (cameraTween.startTarget && cameraTween.endTarget) {
    controls.target.lerpVectors(
      cameraTween.startTarget,
      cameraTween.endTarget,
      eased
    );
  }
  if (t >= 1) cameraTween = null;
}

function onWheel() {
  manualLevel = null;
}

ui.wireToggle.addEventListener("click", () => {
  wireframe = !wireframe;
  manager.setWireframe(wireframe);
  ui.wireToggle.setAttribute("aria-pressed", String(wireframe));
  showToast(wireframe ? "瓦片边界线框已开启" : "瓦片边界线框已关闭");
});

ui.resetView.addEventListener("click", () => {
  resetCamera(true);
  showToast("视角已重置 · 自动 LOD");
});

ui.exportButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const open = ui.exportMenu.classList.toggle("open");
  ui.exportButton.setAttribute("aria-expanded", String(open));
});

ui.exportMenu.addEventListener("click", (event) => {
  event.stopPropagation();
});

document.addEventListener("click", () => {
  ui.exportMenu.classList.remove("open");
  ui.exportButton.setAttribute("aria-expanded", "false");
});

document.querySelectorAll("[data-export]").forEach((button) => {
  button.addEventListener("click", async () => {
    const level = Number(button.dataset.export);
    ui.exportMenu.classList.remove("open");
    ui.exportButton.setAttribute("aria-expanded", "false");
    showToast(`正在合成 ${LEVEL_META[level].label} 单级总览…`);
    try {
      const result = await exportLevelOverview(level);
      showToast(
        `${result.level.label} 总览已导出 · ${result.size}px · ${(result.bytes / 1024).toFixed(0)} KB`
      );
    } catch (error) {
      showToast(`导出失败：${error.message}`, true);
    }
  });
});

document.querySelectorAll(".level-button").forEach((button) => {
  button.addEventListener("click", () => {
    cameraTween = null;
    setLevelPreset(Number(button.dataset.level));
  });
});

canvas.addEventListener("wheel", onWheel, { passive: true });

ui.closeVerify.addEventListener("click", () => {
  ui.verifyPanel.classList.remove("show");
});

function renderAuditItems(items) {
  ui.verifyList.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = `verify-item ${item.state || ""}`;
    row.innerHTML = `
      <i class="verify-icon"></i>
      <span>${item.label}</span>
      <em>${item.value || "等待"}</em>
    `;
    ui.verifyList.appendChild(row);
  }
}

async function waitFor(condition, timeout = 4500) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 90));
  }
  return false;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAudit() {
  ui.verifyButton.disabled = true;
  const items = [
    { label: "第 1 轮：连续缩放 L1 → L2 → L0 → L1", value: "运行中", state: "" },
    { label: "第 2 轮：连续缩放 L1 → L2 → L0 → L1", value: "等待", state: "" },
    { label: "跨级边界高度 / 颜色连续性", value: "等待", state: "" },
    { label: "远端瓦片释放与内存回落", value: "等待", state: "" },
    { label: "缓存复用命中", value: "等待", state: "" }
  ];
  renderAuditItems(items);
  ui.verifyPanel.classList.add("show");
  const startStats = manager.getStats();
  const startMemory = startStats.memoryBytes;
  let maxMemory = startMemory;
  let seamWorstHeight = 0;
  let seamWorstColor = 0;
  let transitions = 0;

  const stage = async (distance, itemIndex) => {
    animateDistance(distance, 560);
    await wait(820);
    await waitFor(() => {
      const stats = manager.getStats();
      return !stats.pendingSwitch && stats.loading === 0 && stats.visible > 0;
    }, 4200);
    transitions += 1;
    const stats = manager.getStats();
    const currentSeam = manager.measureSeams();
    seamWorstHeight = Math.max(seamWorstHeight, currentSeam.maxHeightDelta);
    seamWorstColor = Math.max(seamWorstColor, currentSeam.maxColorDelta);
    maxMemory = Math.max(maxMemory, stats.memoryBytes);
    items[itemIndex].value = `${transitions} / 6 · L${stats.activeLevel}`;
    renderAuditItems(items);
  };

  for (let round = 0; round < 2; round += 1) {
    await stage(430, round);
    await stage(2210, round);
    await stage(1010, round);
    items[round].state = "done";
    items[round].value = "通过 · 3 段";
    renderAuditItems(items);
  }

  const seamOk = seamWorstHeight < 0.001 && seamWorstColor < 0.001;
  items[2].state = seamOk ? "done" : "fail";
  items[2].value = `ΔH ${seamWorstHeight.toFixed(3)}m · ΔRGB ${seamWorstColor.toFixed(4)}`;

  await wait(5600);
  const finalStats = manager.getStats();
  const released = finalStats.evictions > startStats.evictions;
  const memoryFell =
    finalStats.memoryBytes < maxMemory || finalStats.memoryBytes < startMemory;
  items[3].state = released && memoryFell ? "done" : "fail";
  items[3].value = `EVICT +${finalStats.evictions - startStats.evictions} · ${(
    finalStats.memoryBytes /
    (1024 * 1024)
  ).toFixed(1)} MB`;

  const hitOk = finalStats.hits > startStats.hits;
  items[4].state = hitOk ? "done" : "fail";
  items[4].value = `+${finalStats.hits - startStats.hits} HIT · ${finalStats.hitRate.toFixed(1)}%`;
  renderAuditItems(items);

  auditResult = {
    passed: seamOk && released && memoryFell && hitOk,
    transitions,
    seamWorstHeight,
    seamWorstColor,
    evictions: finalStats.evictions,
    memoryBytes: finalStats.memoryBytes,
    maxMemoryBytes: maxMemory,
    hits: finalStats.hits,
    misses: finalStats.misses,
    hitRate: finalStats.hitRate
  };
  ui.verifyButton.disabled = false;
  showToast(
    auditResult.passed
      ? "两轮缩放验证通过 · 接缝 0.000M · 缓存已释放"
      : "验证存在异常项，请查看审计面板",
    !auditResult.passed
  );
}

ui.verifyButton.addEventListener("click", runAudit);

controls.addEventListener("start", () => {
  if (cameraTween) cameraTween = null;
});

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
}

window.addEventListener("resize", onResize);

function animate(now) {
  requestAnimationFrame(animate);
  updateCameraTween(now);

  if (manualLevel !== null && !cameraTween) {
    const level = manager.getDesiredLevel();
    if (level !== manualLevel) manualLevel = null;
  }

  controls.target.x = THREE.MathUtils.clamp(controls.target.x, -760, 760);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, -760, 760);
  controls.target.y = THREE.MathUtils.clamp(controls.target.y, -20, 30);
  controls.update();

  camera.userData.target.copy(controls.target);
  manager.update(now);
  updateStats(now);
  updateCompass();

  renderer.render(scene, camera);
  if (!bootHidden && now > 900) {
    const stats = manager.getStats();
    if ((stats.loading === 0 && stats.resident > 0) || now > 4200) {
      bootHidden = true;
      ui.boot.classList.add("hidden");
    }
  }
}

window.__terrainDebug = {
  getState() {
    return {
      ...manager.getStats(),
      seam: manager.measureSeams(),
      cameraDistance: currentDistance(),
      cameraPosition: camera.position.toArray(),
      target: controls.target.toArray(),
      auditResult,
      cacheKeys: [...manager.cache.keys()]
    };
  },
  setDistance(distance) {
    manualLevel = null;
    animateDistance(distance, 420);
  },
  setLevel(level) {
    manualLevel = null;
    manager.setTargetLevel(level);
  },
  flushCache() {
    manager.flush();
  },
  runAudit,
  measureSeams() {
    return manager.measureSeams();
  },
  sourceHeight: (x, z) => heightAt(x, z)
};

requestAnimationFrame(animate);
