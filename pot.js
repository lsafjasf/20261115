/* 低多边形陶罐：轮廓点 -> 旋转体三角网格 -> OBJ 导出/解析
 * 浏览器 (window.Pot) 与 Node (module.exports) 共用。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pot = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_SEGMENTS = 20;

  // 自下而上的轮廓控制点：瓶底 -> 瓶口
  function defaultProfile() {
    return [
      { name: '瓶底', r: 0.5, h: 0.0 },
      { name: '下腹', r: 0.82, h: 0.42 },
      { name: '腹部', r: 1.05, h: 0.95 },
      { name: '肩部', r: 0.72, h: 1.45 },
      { name: '颈部', r: 0.44, h: 1.75 },
      { name: '瓶口', r: 0.6, h: 2.05 },
    ];
  }

  // 旋转成型：底部用扇形封闭，瓶口敞开（唯一边界环）。
  // 所有三角形按逆时针（外侧观察）绕序，法线朝外，旋转不会翻面。
  function buildMesh(profile, segments) {
    const seg = segments || DEFAULT_SEGMENTS;
    const rings = profile.length;
    const positions = [];
    for (let i = 0; i < rings; i++) {
      const pt = profile[i];
      for (let j = 0; j < seg; j++) {
        const t = (j / seg) * Math.PI * 2;
        positions.push(pt.r * Math.cos(t), pt.h, pt.r * Math.sin(t));
      }
    }
    const bottomCenter = positions.length / 3;
    positions.push(0, profile[0].h, 0);

    const faces = [];
    for (let j = 0; j < seg; j++) {
      faces.push([bottomCenter, j, (j + 1) % seg]); // 底面，法线朝下
    }
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = i * seg + j;
        const b = i * seg + ((j + 1) % seg);
        const c = (i + 1) * seg + ((j + 1) % seg);
        const d = (i + 1) * seg + j;
        faces.push([a, c, b]);
        faces.push([a, d, c]);
      }
    }
    return { positions: positions, faces: faces, segments: seg, rings: rings };
  }

  function toOBJ(mesh, name) {
    const p = mesh.positions;
    const lines = ['# low-poly clay pot (lathe, bottom capped, mouth open)', 'o ' + (name || 'pot')];
    for (let i = 0; i < p.length; i += 3) {
      lines.push('v ' + p[i].toFixed(6) + ' ' + p[i + 1].toFixed(6) + ' ' + p[i + 2].toFixed(6));
    }
    for (const f of mesh.faces) {
      lines.push('f ' + (f[0] + 1) + ' ' + (f[1] + 1) + ' ' + (f[2] + 1));
    }
    return lines.join('\n') + '\n';
  }

  function parseOBJ(text) {
    const positions = [];
    const faces = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.indexOf('v ') === 0) {
        const parts = line.slice(2).trim().split(/\s+/).map(Number);
        positions.push(parts[0], parts[1], parts[2]);
      } else if (line.indexOf('f ') === 0) {
        const idx = line.slice(2).trim().split(/\s+/).map(function (tok) {
          const i = parseInt(tok.split('/')[0], 10);
          return i < 0 ? positions.length / 3 + i : i - 1;
        });
        for (let k = 1; k + 1 < idx.length; k++) faces.push([idx[0], idx[k], idx[k + 1]]);
      }
    }
    return { positions: positions, faces: faces };
  }

  // 只被引用一次的边即边界边（瓶口一圈）
  function boundaryEdges(faces) {
    const count = new Map();
    for (const f of faces) {
      for (let k = 0; k < f.length; k++) {
        const a = f[k];
        const b = f[(k + 1) % f.length];
        const key = a < b ? a + '_' + b : b + '_' + a;
        count.set(key, (count.get(key) || 0) + 1);
      }
    }
    const edges = [];
    for (const entry of count) {
      if (entry[1] === 1) edges.push(entry[0].split('_').map(Number));
    }
    return edges;
  }

  function faceNormal(positions, f) {
    const ax = positions[f[0] * 3], ay = positions[f[0] * 3 + 1], az = positions[f[0] * 3 + 2];
    const bx = positions[f[1] * 3], by = positions[f[1] * 3 + 1], bz = positions[f[1] * 3 + 2];
    const cx = positions[f[2] * 3], cy = positions[f[2] * 3 + 1], cz = positions[f[2] * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return [nx / len, ny / len, nz / len];
  }

  return {
    DEFAULT_SEGMENTS: DEFAULT_SEGMENTS,
    defaultProfile: defaultProfile,
    buildMesh: buildMesh,
    toOBJ: toOBJ,
    parseOBJ: parseOBJ,
    boundaryEdges: boundaryEdges,
    faceNormal: faceNormal,
  };
});
