import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CITY_SIZE,
  cityStats,
  generateCity,
  sampleSkyline,
} from "./city.js";
import {
  createBuildingGroup,
  createGround,
  createParks,
  createRoadTexture,
  createTrees,
  disposeGroup,
} from "./visuals.js";

const HOME_POSITION = new THREE.Vector3(155, 112, 174);
const HOME_TARGET = new THREE.Vector3(0, 16, 0);
const TOP_POSITION = new THREE.Vector3(0.1, 218, 0.2);
const TOP_TARGET = new THREE.Vector3(0, 0, 0);

function easeInOutCubic(value) {
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}

export class CityScene {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x071416, 0.0027);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
    this.camera.position.copy(HOME_POSITION);
    this.camera.lookAt(HOME_TARGET);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.copy(HOME_TARGET);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 58;
    this.controls.maxDistance = 300;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.autoRotateSpeed = 0.48;
    this.controls.enablePan = false;

    this.cityRoot = new THREE.Group();
    this.cityRoot.name = "city-root";
    this.scene.add(this.cityRoot);
    this.buildingGroups = new Map();
    this.buildingMeshes = [];
    this.selectionMarker = null;
    this.selectedId = null;
    this.currentCity = null;
    this.rebuildCount = 0;
    this.buildingRevision = 0;
    this.editRevision = 0;
    this.layerMode = false;
    this.layerThreshold = 64;
    this.layerAnimation = null;
    this.cameraAnimation = null;
    this.pointerStart = null;
    this.pickRaycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.clock = new THREE.Clock();
    this.lastFpsAt = performance.now();
    this.frameCount = 0;
    this.running = true;

    this.setupLights();
    this.setupStaticGround();
    this.resize();
    this.bindEvents();
    this.render = this.render.bind(this);
    this.animate();
  }

  setupLights() {
    const hemisphere = new THREE.HemisphereLight(0xaac9b8, 0x071012, 2.05);
    this.scene.add(hemisphere);

    const keyLight = new THREE.DirectionalLight(0xfff3d7, 3.15);
    keyLight.position.set(72, 122, 58);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -92;
    keyLight.shadow.camera.right = 92;
    keyLight.shadow.camera.top = 92;
    keyLight.shadow.camera.bottom = -92;
    keyLight.shadow.camera.near = 12;
    keyLight.shadow.camera.far = 260;
    keyLight.shadow.bias = -0.0007;
    keyLight.shadow.normalBias = 0.16;
    keyLight.shadow.radius = 2.5;
    this.scene.add(keyLight);

    const coolFill = new THREE.DirectionalLight(0x78aeb2, 1.2);
    coolFill.position.set(-90, 45, -76);
    this.scene.add(coolFill);

    const rimLight = new THREE.DirectionalLight(0xe4f6c3, 0.75);
    rimLight.position.set(-25, 22, 110);
    this.scene.add(rimLight);
  }

  setupStaticGround() {
    const ground = createGround();
    this.staticGroundGroup = ground.group;
    this.scene.add(this.staticGroundGroup);
    this.groundDispose = () => {
      ground.plinthGeometry.dispose();
      ground.plinthMaterial.dispose();
      ground.edgeGeometry.dispose();
      ground.edgeMaterial.dispose();
    };

    const boundaryPoints = [
      new THREE.Vector3(-CITY_SIZE / 2, 0.94, -CITY_SIZE / 2),
      new THREE.Vector3(CITY_SIZE / 2, 0.94, -CITY_SIZE / 2),
      new THREE.Vector3(CITY_SIZE / 2, 0.94, CITY_SIZE / 2),
      new THREE.Vector3(-CITY_SIZE / 2, 0.94, CITY_SIZE / 2),
    ];
    const boundaryGeometry = new THREE.BufferGeometry().setFromPoints(boundaryPoints);
    const boundaryMaterial = new THREE.LineBasicMaterial({
      color: 0xb8dd8a,
      transparent: true,
      opacity: 0.34,
    });
    this.boundaryLine = new THREE.LineLoop(boundaryGeometry, boundaryMaterial);
    this.scene.add(this.boundaryLine);

    this.scanPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_SIZE + 8, CITY_SIZE + 8),
      new THREE.MeshBasicMaterial({
        color: 0xd8ff75,
        transparent: true,
        opacity: 0.045,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.scanPlane.rotation.x = -Math.PI / 2;
    this.scanPlane.position.y = 0.96;
    this.scanPlane.visible = false;
    this.scene.add(this.scanPlane);
  }

  bindEvents() {
    window.addEventListener("resize", () => this.resize());
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.pointerStart = { x: event.clientX, y: event.clientY };
    });
    this.canvas.addEventListener("pointerup", (event) => {
      if (!this.pointerStart || event.button !== 0) return;
      const distance = Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y);
      this.pointerStart = null;
      if (distance < 5) this.handleClick(event.clientX, event.clientY);
    });
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(width, height, false);
    const aspect = width / Math.max(1, height);
    this.camera.aspect = aspect;
    this.camera.zoom = aspect < 1 ? Math.max(0.54, aspect * 1.08) : 1;
    this.camera.updateProjectionMatrix();
  }

  buildCity(params) {
    const city = generateCity(params);
    this.currentCity = city;
    this.rebuildCount += 1;
    this.buildingRevision += 1;
    this.clearSelection();
    disposeGroup(this.cityRoot);
    while (this.cityRoot.children.length) this.cityRoot.remove(this.cityRoot.children[0]);
    this.buildingGroups.clear();
    this.buildingMeshes = [];

    const roadTexture = createRoadTexture(city.density);
    const roadGeometry = new THREE.PlaneGeometry(CITY_SIZE, CITY_SIZE);
    roadGeometry.rotateX(-Math.PI / 2);
    const roadMaterial = new THREE.MeshStandardMaterial({
      map: roadTexture,
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0.02,
    });
    const roadMesh = new THREE.Mesh(roadGeometry, roadMaterial);
    roadMesh.position.y = 0.81;
    roadMesh.receiveShadow = true;
    this.cityRoot.add(roadMesh);

    const parks = createParks(city.parks);
    this.cityRoot.add(parks);
    const trees = createTrees(city.trees);
    this.cityRoot.add(trees);
    city.buildings.forEach((building) => this.addBuilding(building, false));
    this.applyLayerVisibility();

    const stats = cityStats(city);
    this.callbacks.onCityReady?.(city, stats, { rebuildCount: this.rebuildCount });
    return city;
  }

  addBuilding(building, disposePrevious = true) {
    const previous = this.buildingGroups.get(building.id);
    if (previous) {
      if (disposePrevious) {
        disposeGroup(previous);
        this.cityRoot.remove(previous);
      } else {
        return previous;
      }
    }
    const group = createBuildingGroup(building, this.renderer);
    group.position.set(building.x, 0.82, building.z);
    group.rotation.y = building.rotation;
    group.userData.floors = building.floors;
    this.cityRoot.add(group);
    this.buildingGroups.set(building.id, group);
    this.buildingMeshes.push(...group.children.filter((child) => child.isMesh));
    return group;
  }

  replaceBuilding(updatedBuilding) {
    if (!this.currentCity) return null;
    const index = this.currentCity.buildings.findIndex((building) => building.id === updatedBuilding.id);
    if (index === -1) return null;
    const oldGroup = this.buildingGroups.get(updatedBuilding.id);
    this.currentCity.buildings[index] = updatedBuilding;
    this.buildingMeshes = this.buildingMeshes.filter((mesh) => mesh.userData.buildingId !== updatedBuilding.id);
    if (oldGroup) {
      disposeGroup(oldGroup);
      this.cityRoot.remove(oldGroup);
    }
    this.buildingGroups.delete(updatedBuilding.id);
    const group = this.addBuilding(updatedBuilding, false);
    this.buildingRevision += 1;
    this.editRevision += 1;
    this.applyLayerVisibility();
    this.currentCity.maxFloors = Math.max(...this.currentCity.buildings.map((building) => building.floors));
    this.currentCity.avgFloors =
      this.currentCity.buildings.reduce((sum, building) => sum + building.floors, 0) /
      this.currentCity.buildings.length;
    this.currentCity.profile = sampleSkyline(this.currentCity.buildings, 192);
    if (this.selectedId === updatedBuilding.id) this.selectBuilding(updatedBuilding.id, false);
    return group;
  }

  updateBuilding(buildingId, patch) {
    const building = this.currentCity?.buildings.find((item) => item.id === buildingId);
    if (!building) return null;
    const updated = { ...building };
    if (typeof patch.floors === "number") {
      const floors = Math.max(2, Math.min(72, Math.round(patch.floors)));
      updated.floors = floors;
      if (floors < building.tiers.length * 2) {
        updated.tiers = [{ ...building.tiers[0], floors }];
      } else {
        const tierFloors = building.tiers.map((tier) =>
          Math.max(1, Math.round((tier.floors / building.floors) * floors)),
        );
        const difference = floors - tierFloors.reduce((sum, value) => sum + value, 0);
        tierFloors[0] = Math.max(1, tierFloors[0] + difference);
        updated.tiers = building.tiers.map((tier, index) => ({ ...tier, floors: tierFloors[index] }));
      }
      updated.height = updated.tiers.reduce((sum, tier) => sum + tier.floors, 0) * building.storyHeight;
    }
    if (typeof patch.roof === "string") {
      const labelMap = {
        none: "无",
        antenna: "通信天线",
        tank: "屋顶水箱",
        spire: "塔尖",
        helipad: "停机坪",
        solar: "太阳能板",
        hvac: "设备机房",
      };
      updated.roof = patch.roof;
      updated.roofLabel = labelMap[patch.roof] ?? "无";
    }
    this.replaceBuilding(updated);
    this.callbacks.onBuildingChange?.(updated, { editRevision: this.editRevision });
    return updated;
  }

  setSeed(seed) {
    const numericSeed = String(seed);
    this.currentSeed = numericSeed;
    return numericSeed;
  }

  setLayerMode(enabled, options = {}) {
    this.layerMode = Boolean(enabled);
    const max = Math.max(2, this.currentCity?.maxFloors ?? 64);
    if (this.layerMode && options.animate !== false) {
      this.startLayerAnimation(options.duration ?? 2600);
    } else if (this.layerMode) {
      this.setLayerThreshold(options.value ?? max, true);
    } else {
      this.layerAnimation = null;
      this.applyLayerVisibility();
      this.callbacks.onLayerChange?.({ enabled: false, threshold: max, visible: this.buildingGroups.size, total: this.buildingGroups.size });
    }
  }

  startLayerAnimation(duration = 2600) {
    const max = Math.max(2, this.currentCity?.maxFloors ?? 64);
    this.layerThreshold = 0;
    this.applyLayerVisibility();
    this.layerAnimation = {
      start: performance.now(),
      duration,
      max,
    };
  }

  setLayerThreshold(value, stopAnimation = true) {
    if (stopAnimation) this.layerAnimation = null;
    this.layerThreshold = Math.max(0, Math.min(72, Number(value)));
    this.applyLayerVisibility();
  }

  applyLayerVisibility() {
    const total = this.buildingGroups.size;
    let visible = 0;
    const threshold = this.layerMode ? this.layerThreshold : Infinity;
    for (const [id, group] of this.buildingGroups) {
      const building = this.currentCity?.buildings.find((item) => item.id === id);
      const isVisible = Boolean(building) && building.floors <= threshold;
      group.visible = isVisible;
      if (isVisible) visible += 1;
    }
    if (this.selectionMarker) this.selectionMarker.visible = this.layerMode ? this.isSelectedVisible() : true;
    const scanY = this.layerMode ? 0.95 + Math.max(0, this.layerThreshold) * (this.currentCity?.maxFloors ? 58 / this.currentCity.maxFloors : 1) : 0.95;
    this.scanPlane.position.y = Math.min(61, scanY);
    this.scanPlane.visible = this.layerMode;
    this.callbacks.onLayerChange?.({
      enabled: this.layerMode,
      threshold: this.layerThreshold,
      visible,
      total,
      max: this.currentCity?.maxFloors ?? 64,
    });
  }

  isSelectedVisible() {
    if (!this.layerMode) return true;
    const building = this.currentCity?.buildings.find((item) => item.id === this.selectedId);
    return Boolean(building && building.floors <= this.layerThreshold);
  }

  pickAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.pickRaycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.pickRaycaster.intersectObjects(this.buildingGroups.size ? [...this.buildingGroups.values()] : [], true);
    const visibleHits = hits.filter((hit) => hit.object.visible && hit.object.type === "Mesh");
    if (!visibleHits.length) return null;
    const buildingId = visibleHits[0].object.userData.buildingId;
    const building = this.currentCity?.buildings.find((item) => item.id === buildingId);
    return { building, intersection: visibleHits[0], hits: visibleHits };
  }

  handleClick(clientX, clientY) {
    const picked = this.pickAt(clientX, clientY);
    if (!picked?.building) {
      this.clearSelection();
      this.callbacks.onSelect?.(null);
      return;
    }
    this.selectBuilding(picked.building.id);
    this.callbacks.onSelect?.(picked.building);
  }

  selectBuilding(buildingId, notify = true) {
    const building = this.currentCity?.buildings.find((item) => item.id === buildingId);
    if (!building) return;
    this.clearSelection(false);
    this.selectedId = buildingId;
    const group = this.buildingGroups.get(buildingId);
    if (!group) return;
    const marker = new THREE.Group();
    const width = Math.max(...building.tiers.map((tier) => tier.width));
    const depth = Math.max(...building.tiers.map((tier) => tier.depth));
    const radius = Math.max(width, depth) * 0.61;
    const ringGeometry = new THREE.RingGeometry(radius * 0.94, radius, 32);
    ringGeometry.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({ color: 0xd8ff75, transparent: true, opacity: 0.82, depthWrite: false }),
    );
    ring.position.copy(group.position);
    ring.position.y = 0.97;
    marker.add(ring);

    const outlineGeometry = new THREE.BoxGeometry(width + 0.35, group.userData.height + 0.15, depth + 0.35);
    outlineGeometry.translate(0, (group.userData.height + 0.15) / 2, 0);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(outlineGeometry),
      new THREE.LineBasicMaterial({ color: 0xd8ff75, transparent: true, opacity: 0.36, depthWrite: false }),
    );
    edges.position.copy(group.position);
    marker.add(edges);
    this.scene.add(marker);
    this.selectionMarker = marker;
    this.selectionMarker.visible = this.isSelectedVisible();
    if (notify) this.callbacks.onSelect?.(building);
  }

  clearSelection(notify = true) {
    if (this.selectionMarker) {
      disposeGroup(this.selectionMarker);
      this.scene.remove(this.selectionMarker);
    }
    this.selectionMarker = null;
    this.selectedId = null;
    if (notify) this.callbacks.onSelect?.(null);
  }

  resetCamera(animated = true) {
    this.moveCamera(HOME_POSITION, HOME_TARGET, animated ? 900 : 0);
  }

  setTopView(animated = true) {
    this.moveCamera(TOP_POSITION, TOP_TARGET, animated ? 1000 : 0);
  }

  moveCamera(position, target, duration = 900) {
    if (!duration) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.cameraAnimation = {
      start: performance.now(),
      duration,
      fromPosition: this.camera.position.clone(),
      toPosition: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
    };
  }

  orbitTo(azimuthDegrees, elevationDegrees, distance = 178) {
    const azimuth = THREE.MathUtils.degToRad(azimuthDegrees);
    const elevation = THREE.MathUtils.degToRad(elevationDegrees);
    const target = new THREE.Vector3(0, 16, 0);
    const position = new THREE.Vector3(
      target.x + Math.cos(elevation) * Math.sin(azimuth) * distance,
      target.y + Math.sin(elevation) * distance,
      target.z + Math.cos(elevation) * Math.cos(azimuth) * distance,
    );
    this.moveCamera(position, target, 0);
  }

  setAutoRotate(enabled) {
    this.controls.autoRotate = Boolean(enabled);
  }

  getCameraState() {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      azimuth: THREE.MathUtils.radToDeg(this.controls.getAzimuthalAngle()),
      polar: THREE.MathUtils.radToDeg(this.controls.getPolarAngle()),
    };
  }

  findOcclusionProbe() {
    if (!this.currentCity) return null;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const startX = Math.max(360, width * 0.34);
    const endX = Math.min(width - 360, width * 0.68);
    const startY = Math.max(130, height * 0.2);
    const endY = Math.min(height - 110, height * 0.75);
    for (let y = startY; y <= endY; y += 18) {
      for (let x = startX; x <= endX; x += 18) {
        const picked = this.pickAt(x, y);
        if (!picked?.hits?.length) continue;
        const front = picked.hits[0];
        const back = picked.hits.find((hit) => hit.object.userData.buildingId !== front.object.userData.buildingId);
        if (back) {
          return {
            x,
            y,
            frontId: front.object.userData.buildingId,
            backId: back.object.userData.buildingId,
            frontDistance: front.distance,
            backDistance: back.distance,
            depthOrderCorrect: front.distance < back.distance,
          };
        }
      }
    }
    return null;
  }

  findClickableBuilding() {
    if (!this.currentCity) return null;
    this.camera.updateMatrixWorld();
    const rect = this.canvas.getBoundingClientRect();
    const point = new THREE.Vector3();
    const minX = 340;
    const maxX = rect.width - 350;
    const minY = 115;
    const maxY = rect.height - 95;
    const candidates = [...this.buildingGroups.entries()].reverse();
    for (const [id, group] of candidates) {
      if (!group.visible) continue;
      point.set(group.position.x, group.position.y + group.userData.height * 0.55, group.position.z);
      point.project(this.camera);
      const clientX = rect.left + ((point.x + 1) / 2) * rect.width;
      const clientY = rect.top + ((1 - point.y) / 2) * rect.height;
      if (clientX < minX || clientX > maxX || clientY < minY || clientY > maxY) continue;
      const picked = this.pickAt(clientX, clientY);
      if (picked?.building?.id === id) {
        return { id, clientX, clientY };
      }
    }
    return null;
  }

  getState() {
    if (!this.currentCity) return null;
    return {
      seed: this.currentCity.params.seed,
      rebuildCount: this.rebuildCount,
      buildingRevision: this.buildingRevision,
      editRevision: this.editRevision,
      buildingCount: this.currentCity.buildings.length,
      visibleBuildings: [...this.buildingGroups.values()].filter((group) => group.visible).length,
      selectedId: this.selectedId,
      layerMode: this.layerMode,
      layerThreshold: this.layerThreshold,
      camera: this.getCameraState(),
      buildingIds: [...this.buildingGroups.keys()],
      buildingPositions: this.currentCity.buildings.map((building) => ({
        id: building.id,
        x: building.x,
        z: building.z,
        floors: building.floors,
      })),
    };
  }

  getScreenshotDataURL(meta = {}) {
    this.renderer.render(this.scene, this.camera);
    const source = this.renderer.domElement;
    const output = document.createElement("canvas");
    output.width = source.width;
    output.height = source.height;
    const context = output.getContext("2d");
    context.clearRect(0, 0, output.width, output.height);
    context.drawImage(source, 0, 0);
    const scale = output.width / Math.max(1, source.clientWidth);
    context.fillStyle = "rgba(216, 255, 117, 0.9)";
    context.fillRect(28 * scale, 28 * scale, 3 * scale, 34 * scale);
    context.font = `600 ${10 * scale}px "Avenir Next", sans-serif`;
    context.letterSpacing = `${2 * scale}px`;
    context.fillStyle = "rgba(239, 247, 231, 0.96)";
    context.fillText("SEEDSCAPE / CITY SILHOUETTE", 42 * scale, 43 * scale);
    context.font = `${22 * scale}px "Iowan Old Style", Georgia, serif`;
    context.fillStyle = "rgba(216, 255, 117, 0.94)";
    context.fillText(`SEED ${meta.seed ?? this.currentCity?.params.seed ?? ""}`, 28 * scale, 78 * scale);
    context.font = `${8 * scale}px "Avenir Next", sans-serif`;
    context.fillStyle = "rgba(192, 210, 198, 0.72)";
    context.fillText(
      `${meta.buildings ?? this.currentCity?.buildings.length ?? 0} BUILDINGS  ·  ${meta.maxFloors ?? this.currentCity?.maxFloors ?? 0}F PEAK  ·  ${new Date().toLocaleDateString("zh-CN")}`,
      30 * scale,
      output.height - 28 * scale,
    );
    return output.toDataURL("image/png");
  }

  animate() {
    if (!this.running) return;
    requestAnimationFrame(this.render);
  }

  render() {
    if (!this.running) return;
    const now = performance.now();
    if (this.cameraAnimation) {
      const progress = Math.min(1, (now - this.cameraAnimation.start) / this.cameraAnimation.duration);
      const eased = easeInOutCubic(progress);
      this.camera.position.lerpVectors(this.cameraAnimation.fromPosition, this.cameraAnimation.toPosition, eased);
      this.controls.target.lerpVectors(this.cameraAnimation.fromTarget, this.cameraAnimation.toTarget, eased);
      if (progress >= 1) this.cameraAnimation = null;
    }
    if (this.layerAnimation) {
      const progress = Math.min(1, (now - this.layerAnimation.start) / this.layerAnimation.duration);
      this.layerThreshold = easeInOutCubic(progress) * this.layerAnimation.max;
      this.applyLayerVisibility();
      if (progress >= 1) {
        this.layerThreshold = this.layerAnimation.max;
        this.layerAnimation = null;
        this.applyLayerVisibility();
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    this.frameCount += 1;
    if (now - this.lastFpsAt > 1000) {
      const fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsAt));
      this.callbacks.onFps?.(fps);
      this.lastFpsAt = now;
      this.frameCount = 0;
    }
    requestAnimationFrame(this.render);
  }

  destroy() {
    this.running = false;
    this.controls.dispose();
    disposeGroup(this.cityRoot);
    this.groundDispose?.();
    this.renderer.dispose();
  }
}
