import { THREE } from './three-bundle.mjs';

export const AXES = ['x', 'y', 'z'];

// Positive axis normal with constant -value keeps the lower-coordinate side
// (dot(n, p) + c <= 0  =>  p.axis <= value), exposing interiors / underground.
const NORMAL = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

// Centralizes global clipping planes and pushes them into every registered material,
// so walls, slabs, roofs, ground and pipes are all cut by the same planes.
export class ClipManager {
  constructor(bounds) {
    this.bounds = bounds;
    this.materials = new Set();
    this.planes = {};
    this.state = {};
    for (const axis of AXES) {
      const [nx, ny, nz] = NORMAL[axis];
      this.planes[axis] = new THREE.Plane(new THREE.Vector3(nx, ny, nz), 0);
      this.state[axis] = { enabled: false, value: 0 };
    }
  }

  registerMaterial(material) {
    this.materials.add(material);
    material.clippingPlanes = this.activePlanes();
    material.clipShadows = true;
    material.needsUpdate = true;
  }

  activePlanes() {
    return AXES.filter((a) => this.state[a].enabled).map((a) => this.planes[a]);
  }

  // value is the plane coordinate on its axis; geometry with coordinate > value is cut
  // (negated normal keeps the lower/left side visible).
  setAxis(axis, { enabled, value }) {
    const next = this.state[axis];
    if (enabled !== undefined) next.enabled = enabled;
    if (value !== undefined) next.value = value;
    const plane = this.planes[axis];
    plane.constant = -next.value;
    const active = this.activePlanes();
    for (const material of this.materials) {
      material.clippingPlanes = active.length ? active : null;
      material.needsUpdate = true;
    }
  }

  toggle(axis, enabled) {
    this.setAxis(axis, { enabled });
  }

 range(axis) {
    const b = this.bounds;
    if (axis === 'x') return [b.minX, b.maxX];
    if (axis === 'z') return [b.minZ, b.maxZ];
    return [b.minY, b.maxY];
  }

  snapshot() {
    return AXES.map((axis) => ({ axis, ...this.state[axis] }));
  }

  restore(snapshot) {
    for (const entry of snapshot) {
      this.setAxis(entry.axis, { enabled: entry.enabled, value: entry.value });
    }
  }
}
