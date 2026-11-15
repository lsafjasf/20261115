import { THREE } from './three-bundle.mjs';
import { buildingHeight } from './citygen.mjs';
import { MATERIAL_COLORS, buildingColor } from './palette.mjs';

const WALL_T = 0.32;
const SLAB_T = 0.28;

function box(parent, w, h, d, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// Pure outline used by tests to verify that an edited building recomputes its profile.
export function buildingOutline(b) {
  const height = buildingHeight(b);
  return {
    id: b.id,
    width: b.width,
    depth: b.depth,
    floors: b.floors,
    floorHeight: b.floorHeight,
    height,
    topY: height,
    bottomY: b.hasBasement ? -4 : 0,
  };
}

export class BuildingFactory {
  constructor(clip) {
    this.clip = clip;
  }

  makeMaterial(color, extra = {}) {
    const material = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: 0.85,
      metalness: 0.05,
      ...extra,
    });
    this.clip.registerMaterial(material);
    return material;
  }

  create(b) {
    const group = new THREE.Group();
    group.name = b.id;
    group.userData.buildingId = b.id;

    const wallMat = this.makeMaterial(buildingColor(b.usage, b.shade));
    const roofMat = this.makeMaterial(MATERIAL_COLORS.roof);
    const slabMat = this.makeMaterial(MATERIAL_COLORS.floorSlab);
    const foundationMat = this.makeMaterial(MATERIAL_COLORS.foundation);

    const { width: w, depth: d } = b;
    const height = buildingHeight(b);

    // Four perimeter walls (hollow interior visible once clipped).
    box(group, w, height, WALL_T, 0, height / 2, d / 2 - WALL_T / 2, wallMat);
    box(group, w, height, WALL_T, 0, height / 2, -d / 2 + WALL_T / 2, wallMat);
    box(group, WALL_T, height, d, w / 2 - WALL_T / 2, height / 2, 0, wallMat);
    box(group, WALL_T, height, d, -w / 2 + WALL_T / 2, height / 2, 0, wallMat);

    // Ground floor slab + one slab between each storey + roof slab.
    for (let f = 0; f <= b.floors; f += 1) {
      const isRoof = f === b.floors;
      box(group, w, SLAB_T, d, 0, f * b.floorHeight, 0, isRoof ? roofMat : slabMat);
    }

    // Foundation and optional basement (underground structure).
    box(group, w + 0.6, 0.6, d + 0.6, 0, -0.3, 0, foundationMat);
    if (b.hasBasement) {
      const basementMat = this.makeMaterial(MATERIAL_COLORS.basement);
      box(group, w, 3.6, WALL_T, 0, -1.8, d / 2 - WALL_T / 2, basementMat);
      box(group, w, 3.6, WALL_T, 0, -1.8, -d / 2 + WALL_T / 2, basementMat);
      box(group, WALL_T, 3.6, d, w / 2 - WALL_T / 2, -1.8, 0, basementMat);
      box(group, WALL_T, 3.6, d, -w / 2 + WALL_T / 2, -1.8, 0, basementMat);
      box(group, w, SLAB_T, d, 0, -3.6, 0, slabMat);
    }

    group.position.set(b.x, 0, b.z);
    group.traverse((obj) => {
      if (obj.isMesh) obj.userData.buildingId = b.id;
    });
    return group;
  }

  dispose(group) {
    group.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.geometry.dispose();
      this.clip.materials.delete(obj.material);
      obj.material.dispose();
    });
  }
}
