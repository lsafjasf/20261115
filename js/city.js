import { mulberry32 } from './utils.js';

// 生成确定性的街区：每栋楼是一个 3D 长方体（世界单位）
export function generateCity(seed = 20261115) {
  const rand = mulberry32(seed);
  const buildings = [];
  const rows = [-7, -17, -28, -40];
  let id = 0;

  for (let row = 0; row < rows.length; row++) {
    const z = rows[row] - rand() * 2;
    let x = -46;
    while (x < 46) {
      const width = 3.2 + rand() * 3.4;
      const depth = 3 + rand() * 3;
      const height = 6 + rand() * (row === 0 ? 12 : 20) + (3 - row) * 1.5;
      const gap = 1.2 + rand() * 1.8;
      const centerX = x + width / 2;
      const hue = 205 + rand() * 35;
      const buildingsData = {
        id: id++,
        x: centerX,
        z,
        width,
        depth,
        height,
        baseColor: `hsl(${hue}, ${28 + rand() * 18}%, ${9 + rand() * 7}%)`,
        sideColor: `hsl(${hue}, 30%, ${5 + rand() * 4}%)`,
        roofColor: `hsl(${hue}, 25%, ${4 + rand() * 3}%)`,
        neon: rand() < 0.32
          ? `hsla(${170 + rand() * 160}, 90%, 62%, 0.9)`
          : null,
        windows: makeWindows(rand, width, depth, height),
      };
      buildings.push(buildingsData);
      x += width + gap;
    }
  }
  return { buildings, rows };
}

// 窗格用建筑本地坐标描述（前表面 z=0 基准，x 居中）
function makeWindows(rand, width, depth, height) {
  const cols = Math.max(2, Math.floor(width / 0.9));
  const floors = Math.max(3, Math.floor(height / 1.1));
  const list = [];
  const cellW = width / cols;
  const cellH = height / floors;
  for (let fy = 0; fy < floors; fy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (rand() < 0.42) continue;
      const warm = rand() < 0.65;
      const lit = rand() < 0.72;
      list.push({
        lx: -width / 2 + cellW * (cx + 0.5),
        ly: cellH * (fy + 0.55),
        w: cellW * 0.42,
        h: cellH * 0.5,
        face: 'front',
        color: lit
          ? warm
            ? `hsla(${34 + rand() * 14}, 95%, ${62 + rand() * 14}%, 0.95)`
            : `hsla(${190 + rand() * 30}, 90%, ${66 + rand() * 12}%, 0.95)`
          : 'rgba(12,18,34,0.9)',
      });
    }
  }
  // 右侧面少量窗户
  const sideCols = Math.max(1, Math.floor(depth / 1.1));
  for (let fy = 0; fy < floors; fy++) {
    for (let sz = 0; sz < sideCols; sz++) {
      if (rand() < 0.6) continue;
      list.push({
        lx: depth / (sideCols + 1) * (sz + 1),
        ly: cellH * (fy + 0.55),
        w: (depth / sideCols) * 0.38,
        h: cellH * 0.5,
        face: 'right',
        color: `hsla(${40 + rand() * 10}, 90%, 65%, 0.85)`,
      });
    }
  }
  return list;
}
