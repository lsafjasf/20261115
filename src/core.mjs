import { THREE } from './three-bundle.mjs';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ClipManager } from './clipping.mjs';
import { BuildingFactory, buildingOutline } from './building.mjs';
import { SceneParts } from './scene-parts.mjs';
import { ClipGizmo } from './gizmo.mjs';
import { generateCity } from './citygen.mjs';

export class CityApp {
  constructor(canvas, statusEl) {
    this.canvas = canvas;
    this.statusEl = statusEl;
    this.model = null;
    this.buildingGroups = new Map();
    this.helperVisible = true;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.localClippingEnabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdfe7ee);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    this.camera.position.set(60, 48, 60);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 6, 0);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x6b7a5a, 1.1);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(40, 70, 30);
    sun.castShadow = true;
    this.scene.add(hemi, sun);

    this.cityRoot = new THREE.Group();
    this.scene.add(this.cityRoot);
  }

  loadModel(model, clipSnapshot) {
    this.model = model;
    this.cityRoot.clear();
    this.buildingGroups.clear();

    this.clip = new ClipManager(model.bounds);
    this.parts = new SceneParts(this.clip).build(model);
    this.cityRoot.add(this.parts);

    this.factory = new BuildingFactory(this.clip);
    for (const b of model.buildings) {
      const group = this.factory.create(b);
      this.buildingGroups.set(b.id, group);
      this.cityRoot.add(group);
    }

    this.gizmo = new ClipGizmo(this.camera, this.canvas, this.clip, model.bounds, () => this.onClipChange?.());
    this.scene.add(this.gizmo.group);
    this.scene.add(this.gizmo.guide);
    if (clipSnapshot) this.clip.restore(clipSnapshot);
    this.gizmo.setVisible(this.helperVisible);
    this.setStatus(`已载入 seed=${model.seed}，建筑 ${model.buildings.length} 栋，管线 ${model.pipes.length} 条`);
  }

  regenerate(seed) {
    this.loadModel(generateCity(seed), null);
  }

  // Rebuild only the edited building; shared clipping planes keep the section in sync.
  updateBuilding(updated) {
    const id = updated.id;
    const index = this.model.buildings.findIndex((b) => b.id === id);
    if (index < 0) return null;
    const next = { ...this.model.buildings[index], ...updated };
    this.model.buildings[index] = next;
    const old = this.buildingGroups.get(id);
    this.cityRoot.remove(old);
    this.factory.dispose(old);
    const group = this.factory.create(next);
    this.buildingGroups.set(id, group);
    this.cityRoot.add(group);
    return { building: next, outline: buildingOutline(next) };
  }

  pickBuilding(event) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const hits = ray.intersectObjects([...this.buildingGroups.values()], true);
    const hit = hits.find((h) => h.object.userData.buildingId);
    if (!hit) return null;
    const id = hit.object.userData.buildingId;
    return this.model.buildings.find((b) => b.id === id) ?? null;
  }

  setHelpersVisible(visible) {
    this.helperVisible = visible;
    if (!this.gizmo) return;
    this.gizmo.setVisible(visible);
    if (!visible) this.gizmo.hideGuide();
  }

  screenshot() {
    this.setHelpersVisible(false);
    this.renderer.render(this.scene, this.camera);
    this.lastShotState = { helperVisible: this.helperVisible, guideVisible: this.gizmo.guide.visible };
    const url = this.renderer.domElement.toDataURL('image/png');
    this.setHelpersVisible(true);
    return url;
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setStatus(text) {
    this.statusEl.textContent = text;
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    this.resize();
    window.addEventListener('resize', () => this.resize());
    loop();
  }
}
