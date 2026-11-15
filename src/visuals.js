import * as THREE from "three";
import { CITY_SIZE } from "./city.js";

const roofMaterials = {
  dark: new THREE.MeshStandardMaterial({ color: 0x283332, roughness: 0.8, metalness: 0.1 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x7f9189, roughness: 0.48, metalness: 0.55 }),
  pale: new THREE.MeshStandardMaterial({ color: 0xb8c2b0, roughness: 0.72 }),
  solar: new THREE.MeshStandardMaterial({ color: 0x254b5d, roughness: 0.3, metalness: 0.55 }),
  beacon: new THREE.MeshBasicMaterial({ color: 0xff7258 }),
  pad: new THREE.MeshStandardMaterial({ color: 0x384644, roughness: 0.9 }),
};
for (const material of Object.values(roofMaterials)) material.userData.shared = true;

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function shadeColor(hex, amount) {
  const color = new THREE.Color(hex);
  color.offsetHSL(0, 0, amount);
  return `#${color.getHexString()}`;
}

export function createFacadeTexture(building, tier, renderer) {
  const stories = Math.max(1, tier.floors);
  const canvas = makeCanvas(128, Math.max(128, Math.min(320, stories * 7)));
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const rng = mulberry32(building.seed + tier.floors * 83);

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, shadeColor(building.color, 0.08));
  gradient.addColorStop(0.5, building.color);
  gradient.addColorStop(1, shadeColor(building.color, -0.1));
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "rgba(8, 16, 17, 0.3)";
  context.fillRect(0, 0, 5, height);
  context.fillRect(width - 5, 0, 5, height);
  context.fillRect(0, height - 6, width, 6);

  const columns = Math.max(3, Math.min(8, Math.round(tier.width / 1.35)));
  const rows = Math.max(4, Math.min(46, Math.round(stories / 1.65)));
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const windowWidth = cellWidth * 0.56;
  const windowHeight = cellHeight * 0.4;
  const marginX = (cellWidth - windowWidth) / 2;
  const marginY = (cellHeight - windowHeight) / 2;
  const litRatio = building.style === "glass" ? 0.38 : 0.23;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * cellWidth + marginX;
      const y = row * cellHeight + marginY;
      const lit = rng() < litRatio;
      if (lit) {
        const warm = rng() < 0.24;
        context.fillStyle = warm ? "rgba(239, 199, 128, 0.72)" : "rgba(176, 222, 205, 0.64)";
      } else {
        context.fillStyle = "rgba(16, 32, 33, 0.6)";
      }
      context.fillRect(x, y, windowWidth, windowHeight);
      if (lit && rng() > 0.7) {
        context.fillStyle = "rgba(246, 255, 214, 0.35)";
        context.fillRect(x, y, windowWidth, Math.max(1, windowHeight * 0.28));
      }
    }
  }

  if (building.style === "glass") {
    context.fillStyle = "rgba(213, 236, 218, 0.2)";
    context.fillRect(width * 0.18, 0, 2, height);
    context.fillRect(width * 0.72, 0, 1, height);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBuildingGroup(building, renderer) {
  const group = new THREE.Group();
  group.name = `building-${building.id}`;
  group.userData.buildingId = building.id;
  let currentHeight = 0;
  const materials = [];
  const geometries = [];
  const textures = [];

  for (const tier of building.tiers) {
    const tierHeight = tier.floors * building.storyHeight;
    const geometry = new THREE.BoxGeometry(tier.width, tierHeight, tier.depth);
    geometry.translate(0, currentHeight + tierHeight / 2, 0);
    const texture = createFacadeTexture(building, tier, renderer);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      emissiveMap: texture,
      emissive: new THREE.Color(0x8db2a5),
      emissiveIntensity: 0.05,
      roughness: building.style === "glass" ? 0.33 : 0.68,
      metalness: building.style === "glass" ? 0.33 : 0.08,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.buildingId = building.id;
    group.add(mesh);
    materials.push(material);
    geometries.push(geometry);
    textures.push(texture);
    currentHeight += tierHeight;
  }

  const topTier = building.tiers[building.tiers.length - 1];
  const roofGroup = createRoofComponent(building, topTier, currentHeight);
  if (roofGroup) {
    roofGroup.userData.buildingId = building.id;
    roofGroup.traverse((child) => {
      child.userData.buildingId = building.id;
    });
    group.add(roofGroup);
  }

  group.userData.height = currentHeight;
  group.userData.dispose = () => {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    roofGroup?.userData.dispose?.();
  };
  return group;
}

function addMesh(group, geometry, material) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function createRoofComponent(building, topTier, height) {
  if (building.roof === "none") return null;
  const group = new THREE.Group();
  group.position.y = height;
  const rng = mulberry32(building.seed + 4337);
  const roofWidth = topTier.width;
  const roofDepth = topTier.depth;
  const geometries = [];
  const localMaterials = [];

  const add = (geometry, material) => {
    geometries.push(geometry);
    if (!Object.values(roofMaterials).includes(material)) localMaterials.push(material);
    addMesh(group, geometry, material);
  };

  const parapetMaterial = new THREE.MeshStandardMaterial({
    color: shadeColor(building.color, -0.16),
    roughness: 0.74,
  });
  localMaterials.push(parapetMaterial);
  const parapetHeight = 0.38;
  const parapetGeometryA = new THREE.BoxGeometry(roofWidth + 0.08, parapetHeight, 0.2);
  parapetGeometryA.translate(0, parapetHeight / 2, roofDepth / 2 - 0.08);
  const parapetGeometryB = new THREE.BoxGeometry(roofWidth + 0.08, parapetHeight, 0.2);
  parapetGeometryB.translate(0, parapetHeight / 2, -roofDepth / 2 + 0.08);
  add(parapetGeometryA, parapetMaterial);
  add(parapetGeometryB, parapetMaterial);

  if (building.roof === "antenna") {
    const mastHeight = 5 + rng() * 5 + Math.min(6, building.floors * 0.08);
    const mastGeometry = new THREE.CylinderGeometry(0.075, 0.15, mastHeight, 6);
    mastGeometry.translate(roofWidth * 0.18, mastHeight / 2, -roofDepth * 0.12);
    add(mastGeometry, roofMaterials.metal);
    const armGeometry = new THREE.BoxGeometry(roofWidth * 0.75, 0.07, 0.07);
    armGeometry.translate(roofWidth * 0.18, mastHeight * 0.68, -roofDepth * 0.12);
    add(armGeometry, roofMaterials.metal);
    const beaconGeometry = new THREE.SphereGeometry(0.16, 8, 6);
    beaconGeometry.translate(roofWidth * 0.18, mastHeight, -roofDepth * 0.12);
    add(beaconGeometry, roofMaterials.beacon);
  }

  if (building.roof === "tank") {
    const tankRadius = Math.min(1.05, roofWidth * 0.18);
    const tankHeight = 1.35 + rng() * 1.2;
    const tankGeometry = new THREE.CylinderGeometry(tankRadius, tankRadius, tankHeight, 10);
    tankGeometry.translate(-roofWidth * 0.16, tankHeight / 2 + 0.45, roofDepth * 0.1);
    add(tankGeometry, roofMaterials.pale);
    const capGeometry = new THREE.CylinderGeometry(tankRadius * 0.86, tankRadius, 0.22, 10);
    capGeometry.translate(-roofWidth * 0.16, tankHeight + 0.56, roofDepth * 0.1);
    add(capGeometry, roofMaterials.dark);
    for (const xOffset of [-0.4, 0.4]) {
      const legGeometry = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 5);
      legGeometry.translate(-roofWidth * 0.16 + xOffset * tankRadius, 0.23, roofDepth * 0.1);
      add(legGeometry, roofMaterials.metal);
    }
  }

  if (building.roof === "spire") {
    const spireHeight = 6 + rng() * 7 + Math.min(9, building.floors * 0.12);
    const spireGeometry = new THREE.ConeGeometry(Math.min(0.65, roofWidth * 0.11), spireHeight, 8);
    spireGeometry.translate(0, spireHeight / 2 + 0.4, 0);
    add(spireGeometry, roofMaterials.metal);
    const needleGeometry = new THREE.CylinderGeometry(0.03, 0.085, spireHeight * 0.4, 6);
    needleGeometry.translate(0, spireHeight + spireHeight * 0.18, 0);
    add(needleGeometry, roofMaterials.metal);
    const beaconGeometry = new THREE.SphereGeometry(0.13, 7, 5);
    beaconGeometry.translate(0, spireHeight + spireHeight * 0.4, 0);
    add(beaconGeometry, roofMaterials.beacon);
  }

  if (building.roof === "helipad") {
    const radius = Math.min(roofWidth, roofDepth) * 0.32;
    const padGeometry = new THREE.CylinderGeometry(radius, radius, 0.16, 24);
    padGeometry.translate(roofWidth * 0.1, 0.48, -roofDepth * 0.08);
    add(padGeometry, roofMaterials.pad);
    const rimGeometry = new THREE.TorusGeometry(radius * 0.78, 0.045, 5, 24);
    rimGeometry.rotateX(Math.PI / 2);
    rimGeometry.translate(roofWidth * 0.1, 0.57, -roofDepth * 0.08);
    add(rimGeometry, roofMaterials.beacon);
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2;
      const post = new THREE.BoxGeometry(0.06, 0.42, 0.06);
      post.translate(
        roofWidth * 0.1 + Math.cos(angle) * radius * 0.82,
        0.55,
        -roofDepth * 0.08 + Math.sin(angle) * radius * 0.82,
      );
      add(post, roofMaterials.beacon);
    }
  }

  if (building.roof === "solar") {
    const panels = 2 + Math.floor(rng() * 3);
    const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x244c58, metalness: 0.58, roughness: 0.32 });
    localMaterials.push(panelMaterial);
    for (let index = 0; index < panels; index += 1) {
      const panelGeometry = new THREE.BoxGeometry(roofWidth * 0.42, 0.08, roofDepth * 0.28);
      panelGeometry.rotateX(-0.18);
      panelGeometry.translate(
        (index % 2 === 0 ? -1 : 1) * roofWidth * 0.16,
        0.48 + Math.floor(index / 2) * 0.3,
        (index % 2 === 0 ? -1 : 1) * roofDepth * 0.12,
      );
      add(panelGeometry, panelMaterial);
    }
  }

  if (building.roof === "hvac") {
    const unitCount = 2 + Math.floor(rng() * 3);
    for (let index = 0; index < unitCount; index += 1) {
      const unitWidth = roofWidth * (0.15 + rng() * 0.2);
      const unitDepth = roofDepth * (0.14 + rng() * 0.18);
      const unitHeight = 0.35 + rng() * 0.7;
      const unitGeometry = new THREE.BoxGeometry(unitWidth, unitHeight, unitDepth);
      unitGeometry.translate(
        (index % 2 === 0 ? -1 : 1) * roofWidth * (0.12 + rng() * 0.16),
        unitHeight / 2 + 0.38,
        (rng() - 0.5) * roofDepth * 0.34,
      );
      add(unitGeometry, index % 3 === 0 ? roofMaterials.dark : roofMaterials.metal);
    }
  }

  group.userData.dispose = () => {
    for (const geometry of geometries) geometry.dispose();
    for (const material of localMaterials) material.dispose();
  };
  return group;
}

export function createRoadTexture(density) {
  const size = 1024;
  const canvas = makeCanvas(size, size);
  const context = canvas.getContext("2d");
  const random = mulberry32(density * 991 + 7789);
  context.fillStyle = "#122321";
  context.fillRect(0, 0, size, size);
  const step = size / density;

  context.fillStyle = "#0a1719";
  for (let index = 0; index < density; index += 1) {
    const x = index * step;
    const y = index * step;
    context.fillRect(x - step * 0.115, 0, step * 0.23, size);
    context.fillRect(0, y - step * 0.115, size, step * 0.23);
  }

  context.strokeStyle = "rgba(132, 157, 144, 0.22)";
  context.lineWidth = Math.max(1.1, step * 0.012);
  context.setLineDash([step * 0.12, step * 0.13]);
  for (let index = 0; index < density; index += 1) {
    const offset = index * step + step / 2;
    context.beginPath();
    context.moveTo(0, offset);
    context.lineTo(size, offset);
    context.stroke();
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset, size);
    context.stroke();
  }
  context.setLineDash([]);

  for (let index = 0; index < density * density * 0.4; index += 1) {
    if (random() > 0.48) continue;
    const x = random() * size;
    const y = random() * size;
    context.fillStyle = `rgba(199, 219, 202, ${0.03 + random() * 0.045})`;
    context.fillRect(x, y, 1.2 + random() * 3, 1.2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export function createGround() {
  const group = new THREE.Group();
  const plinthGeometry = new THREE.BoxGeometry(CITY_SIZE + 9, 1.2, CITY_SIZE + 9);
  const plinthMaterial = new THREE.MeshStandardMaterial({ color: 0x071416, roughness: 0.9, metalness: 0.05 });
  const plinth = new THREE.Mesh(plinthGeometry, plinthMaterial);
  plinth.position.y = -0.62;
  plinth.receiveShadow = true;
  group.add(plinth);

  const edgeGeometry = new THREE.BoxGeometry(CITY_SIZE + 10.4, 0.25, CITY_SIZE + 10.4);
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x203531, roughness: 0.72, metalness: 0.2 });
  const edge = new THREE.Mesh(edgeGeometry, edgeMaterial);
  edge.position.y = -1.08;
  group.add(edge);

  return { group, plinthGeometry, plinthMaterial, edgeGeometry, edgeMaterial };
}

export function createTrees(trees) {
  const group = new THREE.Group();
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4b4132, roughness: 0.9 });
  const leafMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x456f54, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x53785b, roughness: 0.86 }),
    new THREE.MeshStandardMaterial({ color: 0x355d49, roughness: 0.9 }),
  ];
  const trunkGeometry = new THREE.CylinderGeometry(0.06, 0.1, 0.65, 5);
  const leafGeometry = new THREE.IcosahedronGeometry(0.38, 1);

  for (const tree of trees) {
    const treeGroup = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = 0.32;
    const leaves = new THREE.Mesh(leafGeometry, leafMaterials[Math.floor(tree.hue * leafMaterials.length)]);
    leaves.position.y = 0.85;
    leaves.scale.set(1, 1.35, 1);
    leaves.rotation.y = tree.hue * Math.PI;
    treeGroup.add(trunk, leaves);
    treeGroup.position.set(tree.x, 0.82, tree.z);
    treeGroup.scale.setScalar(tree.scale);
    group.add(treeGroup);
  }
  group.userData.dispose = () => {
    trunkGeometry.dispose();
    leafGeometry.dispose();
    trunkMaterial.dispose();
    for (const material of leafMaterials) material.dispose();
  };
  return group;
}

export function createParks(parks) {
  const group = new THREE.Group();
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x365243, roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: 0x405b48, roughness: 0.92 }),
    new THREE.MeshStandardMaterial({ color: 0x2f4c3e, roughness: 0.95 }),
  ];
  const geometries = [];
  for (const park of parks) {
    const geometry = new THREE.PlaneGeometry(park.width, park.depth);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, materials[Math.floor(park.shade * materials.length)]);
    mesh.position.set(park.x, 0.825, park.z);
    mesh.receiveShadow = true;
    group.add(mesh);
    geometries.push(geometry);
  }
  group.userData.dispose = () => {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  };
  return group;
}

export function disposeGroup(group) {
  group.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (material.userData.shared) continue;
        if (material.map) material.map.dispose();
        if (material.emissiveMap && material.emissiveMap !== material.map) material.emissiveMap.dispose();
        material.dispose();
      }
    }
  });
}
