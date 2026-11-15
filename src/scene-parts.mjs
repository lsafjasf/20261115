import { THREE } from './three-bundle.mjs';
import { GROUND_SIZE, GROUND_THICKNESS } from './citygen.mjs';
import { MATERIAL_COLORS } from './palette.mjs';

function cylinderBetween(start, end, radius, material) {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const dir = b.clone().sub(a);
  const length = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 8), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

export class SceneParts {
  constructor(clip) {
    this.clip = clip;
    this.group = new THREE.Group();
  }

  material(color, extra = {}) {
    const material = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: 0.9,
      ...extra,
    });
    this.clip.registerMaterial(material);
    return material;
  }

  buildGround(model) {
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(model.ground.size, model.ground.thickness, model.ground.size),
      // Semi-transparent soil so underground pipes / basements stay visible through
      // the terrain while still being clipped by the section planes.
      this.material(MATERIAL_COLORS.ground, { transparent: true, opacity: 0.32, depthWrite: false }),
    );
    ground.position.y = -model.ground.thickness / 2;
    this.group.add(ground);
  }

  buildRoads(model) {
    const roadMat = this.material(MATERIAL_COLORS.road);
    const extent = model.ground.size / 2;
    for (let i = 0; i <= 4; i += 1) {
      const p = -extent + (i * model.ground.size) / 4;
      const along = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.12, model.ground.size),
        roadMat,
      );
      along.position.set(p, 0.02, 0);
      this.group.add(along);
      const across = new THREE.Mesh(
        new THREE.BoxGeometry(model.ground.size, 0.12, 2.4),
        roadMat,
      );
      across.position.set(0, 0.02, p);
      this.group.add(across);
    }
  }

  buildUtilities(model) {
    const pipeMat = this.material(MATERIAL_COLORS.pipe, { roughness: 0.4, metalness: 0.3 });
    const vaultMat = this.material(MATERIAL_COLORS.vault);
    for (const pipe of model.pipes) {
      this.group.add(cylinderBetween(pipe.from, pipe.to, pipe.radius, pipeMat));
    }
    for (const vault of model.vaults) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(vault.size, vault.size, vault.size),
        vaultMat,
      );
      box.position.set(vault.x, vault.y, vault.z);
      this.group.add(box);
    }
  }

  build(model) {
    this.buildGround(model);
    this.buildRoads(model);
    this.buildUtilities(model);
    return this.group;
  }
}
