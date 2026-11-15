import * as THREE from "three";
import {
  createTileGeometry,
  createTileOutline,
  tileBounds,
  tileKey
} from "./geometry.js";
import {
  LEVEL_META,
  SAMPLE_STEP,
  WORLD_SIZE,
  heightAt
} from "./terrain.js";

const HALF_WORLD = WORLD_SIZE * 0.5;
const LOAD_DELAY_MS = 32;
const SPAWN_INTERVAL_MS = 10;
const OFFSCREEN_GRACE_MS = 2400;
const CROSS_LEVEL_GRACE_MS = 5200;
const MAX_MEMORY_BYTES = 72 * 1024 * 1024;

const OUTLINE_COLORS = [0xe1b477, 0x9fe3c1, 0xa9c7e8];

export class TileManager {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.cache = new Map();
    this.queue = [];
    this.targetRequestSet = new Set();
    this.activeKeys = new Set();
    this.visibleKeys = new Set();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.levelHistory = [];
    this.memoryBytes = 0;
    this.activeLevel = -1;
    this.targetLevel = -1;
    this.wireframe = false;
    this.lastFrameAt = performance.now();
    this.nextSpawnAt = 0;
    this.lastExpireAt = 0;
    this.frustum = new THREE.Frustum();
    this.projection = new THREE.Matrix4();
    this.levelStats = LEVEL_META.map(() => ({
      loaded: 0,
      visible: 0,
      requested: 0
    }));

    this.material = this.createTerrainMaterial();
    this.outlineMaterials = OUTLINE_COLORS.map(
      (color) =>
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          depthTest: true
        })
    );

    this.levelGroups = LEVEL_META.map((level) => {
      const group = new THREE.Group();
      group.name = `LOD-${level.index}`;
      group.visible = false;
      scene.add(group);
      return group;
    });

    this.currentBox = new THREE.Box3();
    this.boxCenter = new THREE.Vector3();
  }

  createTerrainMaterial() {
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0,
      flatShading: false
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vTerrainHeight;"
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvTerrainHeight = position.y;"
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying float vTerrainHeight;"
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          float band = abs(fract((vTerrainHeight + 800.0) / 20.0) - 0.5);
          float contourAA = fwidth(band) * 1.4;
          float contour = 1.0 - smoothstep(0.035, 0.075 + contourAA, band);
          diffuseColor.rgb = mix(
            diffuseColor.rgb,
            diffuseColor.rgb * 1.16 + vec3(0.012),
            contour * 0.26
          );`
        );
    };
    material.customProgramCacheKey = () => "terrain-contour-v1";
    return material;
  }

  getStats() {
    const attempts = this.hits + this.misses;
    const hitRate = attempts > 0 ? (this.hits / attempts) * 100 : 0;
    const activeStats = this.levelStats[this.activeLevel] ?? {
      loaded: 0,
      visible: 0,
      requested: 0
    };
    let loading = 0;
    for (const entry of this.cache.values()) {
      if (entry.state === "building") loading += 1;
    }
    return {
      hitRate,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      memoryBytes: this.memoryBytes,
      resident: activeStats.loaded,
      residentTotal: LEVEL_META[this.activeLevel]?.totalTiles ?? 0,
      activeLevel: this.activeLevel,
      targetLevel: this.targetLevel,
      visible: this.visibleKeys.size,
      loading: loading + this.queue.length,
      queue: this.queue.length,
      levelStats: this.levelStats,
      levelHistory: [...this.levelHistory],
      wireframe: this.wireframe,
      pendingSwitch:
        this.targetLevel >= 0 && this.activeLevel !== this.targetLevel
    };
  }

  setWireframe(enabled) {
    this.wireframe = enabled;
    for (const entry of this.cache.values()) {
      if (entry.outline) entry.outline.visible = enabled;
    }
  }

  getDesiredLevel() {
    if (!this.camera) return 1;
    const distance = this.camera.position.distanceTo(this.camera.userData.target);
    if (distance > 1280) return 0;
    if (distance > 720) return 1;
    return 2;
  }

  setLevel(level, camera, target) {
    this.camera = camera;
    this.camera.userData.target.copy(target);
    this.setTargetLevel(level);
  }

  setTargetLevel(level) {
    if (level === this.targetLevel) return;
    if (level === this.activeLevel) {
      this.targetLevel = level;
      this.targetRequestSet.clear();
      return;
    }
    this.targetLevel = level;
    this.targetRequestSet.clear();
  }

  update(now = performance.now()) {
    if (this.activeLevel < 0) this.activeLevel = this.targetLevel = 1;

    const autoLevel = this.getDesiredLevel();
    if (autoLevel !== this.targetLevel) this.setTargetLevel(autoLevel);

    this.projectFrustum();
    const visible = this.getVisibleKeys(this.targetLevel);

    if (this.targetLevel === this.activeLevel) {
      this.reconcileActive(visible, now);
      this.targetRequestSet.clear();
    } else {
      this.reconcileTarget(visible, now);
      this.maybeSwitchLevel(now);
    }

    this.spawnQueued(now);
    this.finalizeReady(now);
    this.expireEntries(now);
    this.enforceMemoryLimit(now);
    this.publishVisibility();
  }

  projectFrustum() {
    this.projection.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.projection);
  }

  getVisibleKeys(levelIndex) {
    const level = LEVEL_META[levelIndex];
    const keys = new Set();
    for (let z = 0; z < level.grid; z += 1) {
      for (let x = 0; x < level.grid; x += 1) {
        const bounds = tileBounds(level, x, z);
        this.currentBox.min.set(bounds.minX, -220, bounds.minZ);
        this.currentBox.max.set(bounds.maxX, 380, bounds.maxZ);
        if (this.frustum.intersectsBox(this.currentBox)) {
          keys.add(tileKey(level.index, x, z));
        }
      }
    }
    return keys;
  }

  reconcileActive(visible, now) {
    for (const key of visible) {
      if (this.activeKeys.has(key)) continue;
      this.requestTile(key, true, now);
    }

    const nextActive = new Set();
    for (const key of visible) nextActive.add(key);
    for (const key of this.activeKeys) {
      if (nextActive.has(key)) continue;
      const entry = this.cache.get(key);
      if (entry) {
        entry.visible = false;
        if (entry.mesh) entry.mesh.visible = false;
        entry.releaseAt = now + OFFSCREEN_GRACE_MS;
      }
    }
    this.activeKeys = nextActive;
    this.visibleKeys = nextActive;
  }

  reconcileTarget(visible, now) {
    for (const key of visible) {
      if (this.targetRequestSet.has(key)) continue;
      this.targetRequestSet.add(key);
      this.requestTile(key, false, now);
    }
    for (const key of this.targetRequestSet) {
      if (!visible.has(key)) {
        this.targetRequestSet.delete(key);
        const entry = this.cache.get(key);
        if (entry) entry.visible = false;
      }
    }
  }

  requestTile(key, active, now) {
    let entry = this.cache.get(key);
    if (entry?.state === "ready") {
      this.hits += 1;
      entry.lastUsed = now;
      entry.visible = active;
      if (entry.mesh) entry.mesh.visible = active;
      return entry;
    }
    if (entry?.state === "loading" || entry?.state === "building") {
      entry.visible = active;
      entry.lastUsed = now;
      return entry;
    }

    this.misses += 1;
    const [levelIndex, x, z] = key.split(":").map(Number);
    entry = {
      key,
      levelIndex,
      x,
      z,
      state: "loading",
      readyAt: Infinity,
      releaseAt: Infinity,
      lastUsed: now,
      visible: active,
      mesh: null,
      outline: null,
      geometryBytes: 0,
      outlineBytes: 0
    };
    this.cache.set(key, entry);
    this.queue.push(entry);
    this.levelStats[levelIndex].requested += 1;
    return entry;
  }

  maybeSwitchLevel(now) {
    const target = this.targetLevel;
    const desired = this.targetRequestSet;
    if (desired.size === 0) return;
    for (const key of desired) {
      const entry = this.cache.get(key);
      if (!entry?.mesh || entry.state !== "ready") return;
    }

    const previous = this.activeLevel;
    this.activeLevel = target;
    this.levelHistory.push(target);
    if (previous >= 0) {
      this.levelGroups[previous].visible = false;
      for (const [key, entry] of this.cache) {
        if (entry.levelIndex !== previous) continue;
        entry.visible = false;
        if (entry.mesh) entry.mesh.visible = false;
        entry.releaseAt = now + CROSS_LEVEL_GRACE_MS;
      }
    }
    this.levelGroups[target].visible = true;
    this.activeKeys = new Set(desired);
    this.visibleKeys = new Set(desired);
    this.targetRequestSet.clear();
    for (const key of this.activeKeys) {
      const entry = this.cache.get(key);
      entry.visible = true;
      entry.lastUsed = now;
      if (entry.mesh) entry.mesh.visible = true;
    }
  }

  spawnQueued(now) {
    if (now < this.nextSpawnAt) return;
    let guard = this.queue.length;
    let built = 0;
    while (guard > 0 && built < 3) {
      const entry = this.queue.shift();
      guard -= 1;
      if (!entry) break;
      const stillWanted =
        (entry.levelIndex === this.targetLevel &&
          this.targetRequestSet.has(entry.key)) ||
        (entry.levelIndex === this.activeLevel &&
          this.activeKeys.has(entry.key));
      if (!stillWanted || entry.state !== "loading") {
        if (entry.state === "loading") this.cache.delete(entry.key);
        continue;
      }
      entry.state = "building";
      entry.readyAt = now + LOAD_DELAY_MS;
      this.buildTile(entry);
      built += 1;
    }
    if (built > 0) this.nextSpawnAt = now + SPAWN_INTERVAL_MS;
  }

  buildTile(entry) {
    const level = LEVEL_META[entry.levelIndex];
    const geometry = createTileGeometry(level, entry.x, entry.z);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = entry.key;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;

    const outlineGeometry = createTileOutline(level, entry.x, entry.z);
    const outline = new THREE.LineSegments(
      outlineGeometry,
      this.outlineMaterials[entry.levelIndex]
    );
    outline.name = `outline-${entry.key}`;
    outline.visible = this.wireframe;
    outline.renderOrder = 4;
    outline.frustumCulled = false;

    const group = this.levelGroups[entry.levelIndex];
    group.add(mesh);
    group.add(outline);
    entry.mesh = mesh;
    entry.outline = outline;
    entry.geometryBytes = geometry.userData.memoryBytes;
    entry.outlineBytes = outlineGeometry.userData.memoryBytes;
    this.memoryBytes += entry.geometryBytes + entry.outlineBytes;
  }

  finalizeReady(now) {
    for (const entry of this.cache.values()) {
      if (entry.state !== "building" || now < entry.readyAt) continue;
      entry.state = "ready";
      entry.lastUsed = now;
      entry.visible = this.activeLevel === entry.levelIndex
        ? this.activeKeys.has(entry.key)
        : false;
      if (entry.mesh) entry.mesh.visible = entry.visible;
      this.levelStats[entry.levelIndex].loaded += 1;
    }
  }

  publishVisibility() {
    for (const level of this.levelStats) level.visible = 0;
    for (const key of this.visibleKeys) {
      const entry = this.cache.get(key);
      if (!entry || entry.state !== "ready") continue;
      this.levelStats[entry.levelIndex].visible += 1;
    }
  }

  expireEntries(now) {
    if (now - this.lastExpireAt < 180) return;
    this.lastExpireAt = now;
    for (const [key, entry] of this.cache) {
      if (entry.state !== "ready") continue;
      if (entry.levelIndex === this.activeLevel && this.activeKeys.has(key)) {
        continue;
      }
      if (entry.releaseAt === Infinity || now < entry.releaseAt) continue;
      this.evictEntry(key);
    }
  }

  enforceMemoryLimit(now) {
    if (this.memoryBytes <= MAX_MEMORY_BYTES) return;
    const candidates = [...this.cache.entries()]
      .filter(([, entry]) => entry.state === "ready")
      .filter(([key]) => !this.activeKeys.has(key))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key] of candidates) {
      this.evictEntry(key);
      if (this.memoryBytes <= MAX_MEMORY_BYTES) break;
    }
  }

  evictEntry(key) {
    const entry = this.cache.get(key);
    if (!entry) return;
    if (entry.mesh) {
      this.levelGroups[entry.levelIndex].remove(entry.mesh);
      entry.mesh.geometry.dispose();
    }
    if (entry.outline) {
      this.levelGroups[entry.levelIndex].remove(entry.outline);
      entry.outline.geometry.dispose();
    }
    this.memoryBytes = Math.max(
      0,
      this.memoryBytes - entry.geometryBytes - entry.outlineBytes
    );
    if (entry.state === "ready") {
      this.levelStats[entry.levelIndex].loaded = Math.max(
        0,
        this.levelStats[entry.levelIndex].loaded - 1
      );
      this.evictions += 1;
    }
    this.cache.delete(key);
    this.activeKeys.delete(key);
    this.visibleKeys.delete(key);
    this.targetRequestSet.delete(key);
  }

  measureSeams() {
    const edgeHeights = new Map();
    const edgeColors = new Map();
    let maxHeightDelta = 0;
    let maxColorDelta = 0;
    let samples = 0;

    const record = (map, key, value, isColor = false) => {
      const existing = map.get(key);
      if (!existing) {
        map.set(key, value);
        return;
      }
      if (isColor) {
        maxColorDelta = Math.max(
          maxColorDelta,
          Math.abs(existing[0] - value[0]),
          Math.abs(existing[1] - value[1]),
          Math.abs(existing[2] - value[2])
        );
      } else {
        maxHeightDelta = Math.max(maxHeightDelta, Math.abs(existing - value));
        samples += 1;
      }
    };

    for (const entry of this.cache.values()) {
      if (entry.state !== "ready" || !entry.mesh) continue;
      const geometry = entry.mesh.geometry;
      const position = geometry.getAttribute("position");
      const color = geometry.getAttribute("color");
      const bounds = tileBounds(
        LEVEL_META[entry.levelIndex],
        entry.x,
        entry.z
      );
      for (let i = 0; i < position.count; i += 1) {
        const wx = position.getX(i);
        const wz = position.getZ(i);
        const onEdge =
          Math.abs(wx - bounds.minX) < 0.01 ||
          Math.abs(wx - bounds.maxX) < 0.01 ||
          Math.abs(wz - bounds.minZ) < 0.01 ||
          Math.abs(wz - bounds.maxZ) < 0.01;
        if (!onEdge) continue;
        const roundedX = Math.round(wx / SAMPLE_STEP) * SAMPLE_STEP;
        const roundedZ = Math.round(wz / SAMPLE_STEP) * SAMPLE_STEP;
        const edgeKey = `${roundedX}:${roundedZ}`;
        record(edgeHeights, edgeKey, position.getY(i));
        record(
          edgeColors,
          edgeKey,
          [color.getX(i), color.getY(i), color.getZ(i)],
          true
        );
      }
    }

    return {
      maxHeightDelta,
      maxColorDelta,
      samples,
      levelsLoaded: [...new Set([...this.cache.values()].filter(
        (entry) => entry.state === "ready"
      ).map((entry) => entry.levelIndex))].length
    };
  }

  sampleSourceHeight(x, z) {
    return heightAt(x, z);
  }

  flush() {
    for (const key of [...this.cache.keys()]) this.evictEntry(key);
    this.queue = [];
    this.activeKeys.clear();
    this.targetRequestSet.clear();
    this.levelStats.forEach((stats) => {
      stats.loaded = 0;
      stats.visible = 0;
    });
  }
}
