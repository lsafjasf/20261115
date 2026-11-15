import { THREE } from './three-bundle.mjs';
import { MATERIAL_COLORS } from './palette.mjs';

const AXIS_COLOR = { x: MATERIAL_COLORS.handleX, y: MATERIAL_COLORS.handleY, z: MATERIAL_COLORS.handleZ };
const AXIS_VECTOR = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

// Three axis-aligned drag handles plus a dashed guide plane outline on the active axis.
export class ClipGizmo {
  constructor(camera, dom, clip, bounds, onChange) {
    this.camera = camera;
    this.dom = dom;
    this.clip = clip;
    this.bounds = bounds;
    this.onChange = onChange;
    this.group = new THREE.Group();
    this.handles = {};
    this.dragging = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragPlane = new THREE.Plane();
    this.dragPoint = new THREE.Vector3();
    this._buildHandles();
    this._buildGuide();
    this._bind();
  }

  _buildHandles() {
    const centerY = (this.bounds.minY + this.bounds.maxY) / 2;
    for (const axis of ['x', 'y', 'z']) {
      const mat = new THREE.MeshBasicMaterial({ color: AXIS_COLOR[axis], depthTest: false });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), mat);
      mesh.userData.axis = axis;
      mesh.renderOrder = 999;
      this.handles[axis] = mesh;
      this.group.add(mesh);
    }
    this.handles.x.position.set(0, centerY, this.bounds.minZ);
    this.handles.y.position.set(this.bounds.minX, 0, this.bounds.minZ);
    this.handles.z.position.set(this.bounds.minX, centerY, 0);
  }

  _buildGuide() {
    this.guide = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: MATERIAL_COLORS.guide, depthTest: false });
    const s = this.bounds.maxX;
    const square = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-s, -s, 0), new THREE.Vector3(s, -s, 0),
      new THREE.Vector3(s, s, 0), new THREE.Vector3(-s, s, 0),
      new THREE.Vector3(-s, -s, 0),
    ]);
    this.guideLine = new THREE.Line(square, lineMat);
    this.guide.add(this.guideLine);
    this.guide.visible = false;
  }

  showGuide(axis, value) {
    this.guide.visible = true;
    this.guide.position.set(0, 0, 0);
    this.guide.rotation.set(0, 0, 0);
    if (axis === 'x') {
      this.guide.position.x = value;
      this.guide.rotation.y = Math.PI / 2;
    } else if (axis === 'z') {
      this.guide.position.z = value;
    } else {
      this.guide.position.y = value;
      this.guide.rotation.x = Math.PI / 2;
    }
  }

  hideGuide() {
    this.guide.visible = false;
  }

  setVisible(visible) {
    this.group.visible = visible;
    if (!visible) this.guide.visible = false;
  }

  _setPointer(event) {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _bind() {
    this.dom.addEventListener('pointerdown', (e) => {
      this._setPointer(e);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects(Object.values(this.handles), false)[0];
      if (!hit) return;
      const axis = hit.object.userData.axis;
      if (!this.clip.state[axis].enabled) return;
      this.dragging = axis;
      this.dom.setPointerCapture(e.pointerId);
      const normal = AXIS_VECTOR[axis].clone();
      this.dragPlane.setFromNormalAndCoplanarPoint(normal, hit.object.position);
      e.stopImmediatePropagation();
    });
    this.dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this._setPointer(e);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) return;
      const axis = this.dragging;
      const [min, max] = this.clip.range(axis);
      const raw = this.dragPoint[axis === 'x' ? 'x' : axis === 'y' ? 'y' : 'z'];
      const value = Math.max(min, Math.min(max, raw));
      this.clip.setAxis(axis, { value });
      this.showGuide(axis, value);
      this.onChange(axis, value);
    });
    const end = () => {
      if (this.dragging) {
        this.dragging = null;
        this.hideGuide();
      }
    };
    this.dom.addEventListener('pointerup', end);
    this.dom.addEventListener('pointercancel', end);
  }
}
