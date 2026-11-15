import * as THREE from "three";
import {
  SAMPLE_STEP,
  WORLD_SIZE,
  colorAt,
  heightAt
} from "./terrain.js";

const halfWorld = WORLD_SIZE * 0.5;

export function tileKey(level, x, z) {
  return `${level}:${x}:${z}`;
}

export function tileBounds(level, x, z) {
  const minX = x * level.tileSize - halfWorld;
  const maxX = minX + level.tileSize;
  const minZ = z * level.tileSize - halfWorld;
  const maxZ = minZ + level.tileSize;
  return { minX, maxX, minZ, maxZ };
}

export function createTileGeometry(level, x, z) {
  const { minX, maxX, minZ, maxZ } = tileBounds(level, x, z);
  const segments = level.tileSize / SAMPLE_STEP;
  const row = segments + 1;
  const vertexCount = row * row;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(segments * segments * 6);

  let positionOffset = 0;
  let colorOffset = 0;
  for (let iz = 0; iz <= segments; iz += 1) {
    const worldZ = minZ + iz * SAMPLE_STEP;
    for (let ix = 0; ix <= segments; ix += 1) {
      const worldX = minX + ix * SAMPLE_STEP;
      const y = heightAt(worldX, worldZ);
      const dx = heightAt(worldX - 4, worldZ) - heightAt(worldX + 4, worldZ);
      const dz = heightAt(worldX, worldZ - 4) - heightAt(worldX, worldZ + 4);
      const length = Math.hypot(dx, 8, dz) || 1;
      const [r, g, b] = colorAt(worldX, worldZ, y);

      positions[positionOffset] = worldX;
      positions[positionOffset + 1] = y;
      positions[positionOffset + 2] = worldZ;
      normals[positionOffset] = dx / length;
      normals[positionOffset + 1] = 8 / length;
      normals[positionOffset + 2] = dz / length;
      colors[colorOffset] = r / 255;
      colors[colorOffset + 1] = g / 255;
      colors[colorOffset + 2] = b / 255;
      positionOffset += 3;
      colorOffset += 3;
    }
  }

  let indexOffset = 0;
  for (let iz = 0; iz < segments; iz += 1) {
    for (let ix = 0; ix < segments; ix += 1) {
      const a = iz * row + ix;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices[indexOffset] = a;
      indices[indexOffset + 1] = c;
      indices[indexOffset + 2] = b;
      indices[indexOffset + 3] = b;
      indices[indexOffset + 4] = c;
      indices[indexOffset + 5] = d;
      indexOffset += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.memoryBytes =
    positions.byteLength +
    normals.byteLength +
    colors.byteLength +
    indices.byteLength;

  return geometry;
}

export function createTileSkirt(level, x, z) {
  const { minX, maxX, minZ, maxZ } = tileBounds(level, x, z);
  const segments = level.tileSize / SAMPLE_STEP;
  const points = [];
  const edge = (x0, z0, x1, z1) => {
    for (let i = 0; i < segments; i += 1) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const ax = x0 + (x1 - x0) * t0;
      const az = z0 + (z1 - z0) * t0;
      const bx = x0 + (x1 - x0) * t1;
      const bz = z0 + (z1 - z0) * t1;
      points.push(
        ax, heightAt(ax, az) - 0.4, az,
        bx, heightAt(bx, bz) - 0.4, bz,
        ax, heightAt(ax, az) - 16, az,
        bx, heightAt(bx, bz) - 0.4, bz,
        bx, heightAt(bx, bz) - 16, bz,
        ax, heightAt(ax, az) - 16, az
      );
    }
  };
  edge(minX, minZ, maxX, minZ);
  edge(maxX, minZ, maxX, maxZ);
  edge(maxX, maxZ, minX, maxZ);
  edge(minX, maxZ, minX, minZ);
  const buffer = new Float32Array(points);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(buffer, 3));
  geometry.computeVertexNormals();
  geometry.userData.memoryBytes = buffer.byteLength;
  return geometry;
}

export function createTileOutline(level, x, z) {
  const { minX, maxX, minZ, maxZ } = tileBounds(level, x, z);
  const segments = Math.max(8, Math.round(level.tileSize / 16));
  const points = [];
  const corners = [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ]
  ];
  for (let c = 0; c < 4; c += 1) {
    const [x0, z0] = corners[c];
    const [x1, z1] = corners[(c + 1) % 4];
    for (let i = 0; i < segments; i += 1) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      const ax = x0 + (x1 - x0) * t0;
      const az = z0 + (z1 - z0) * t0;
      const bx = x0 + (x1 - x0) * t1;
      const bz = z0 + (z1 - z0) * t1;
      points.push(
        ax, heightAt(ax, az) + 0.65, az,
        bx, heightAt(bx, bz) + 0.65, bz
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(points), 3)
  );
  geometry.userData.memoryBytes = points.length * 4;
  return geometry;
}

export function hexToRgba(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
