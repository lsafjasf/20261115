// test.mjs — 两座岛屿 + 改边后水系修复的自动化验证
import { Island, CONTROL_POINTS } from './terrain.js';

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  PASS  ${msg}`);
  else { failures++; console.error(`  FAIL  ${msg}`); }
}

function riverReachesSea(island, path) {
  if (!path || path.length < 5) return false;
  return island.h[path[path.length - 1]] <= 0;
}

function verifyIsland(island, label) {
  console.log(`\n[${label}] seed=${island.seed}`);
  check(island.rivers.length === 3, `河流数量为 3 (实际 ${island.rivers.length})`);
  island.rivers.forEach((p, i) =>
    check(riverReachesSea(island, p), `河流${i + 1} 流回海岸 (长度 ${p.length})`));
  check(island.villages.length >= 3, `村落数量 >= 3 (实际 ${island.villages.length})`);
  island.villages.forEach((v, i) => {
    const idx = v.j * island.n + v.i;
    check(island.h[idx] > 0, `村落${i + 1} 位于陆地 (h=${island.h[idx].toFixed(3)})`);
    check(!island.wetlandMask[idx], `村落${i + 1} 不在禁入湿地内`);
    check(!island.riverCells.has(idx), `村落${i + 1} 不在河道中`);
  });
  let wetCount = 0;
  for (let i = 0; i < island.wetlandMask.length; i++) wetCount += island.wetlandMask[i];
  check(wetCount > 50, `禁入湿地存在且位于陆地 (${wetCount} 格)`);
  const wt = island.wetland;
  const ellipseCells = Math.PI * wt.rx * wt.ry * island.n * island.n;
  check(wetCount / ellipseCells >= 0.55,
    `湿地陆地覆盖率 >= 55% (实际 ${(wetCount / ellipseCells * 100).toFixed(0)}%)`);
}

for (const seed of [20261114, 887123]) {
  const island = new Island(seed);
  verifyIsland(island, '初始岛屿');

  // 相同 seed 必须得到相同底层地形
  const twin = new Island(seed);
  check(island.checksum() === twin.checksum(), `相同 seed 地形一致 (checksum=${island.checksum()})`);

  // 模拟用户拖动边界: 一处大幅内推、一处外扩
  const cps = island.getControlPoints();
  let inward = cps[0], outward = cps[0];
  for (const cp of cps) {
    if (cp.r > inward.r) inward = cp;
    if (cp.r < outward.r) outward = cp;
  }
  const inR = Math.max(0.12, inward.r * 0.55);
  island.applyBoundaryEdit(inward.index, inR, CONTROL_POINTS);
  const cps2 = island.getControlPoints();
  const outR = Math.min(0.46, cps2[outward.index].r + 0.1);
  island.applyBoundaryEdit(outward.index, outR, CONTROL_POINTS);
  console.log(`  改边: 控制点#${inward.index} 内推至 ${inR.toFixed(3)}, 控制点#${outward.index} 外扩至 ${outR.toFixed(3)}`);

  verifyIsland(island, '改边后(水系修复)');
}

console.log(failures === 0 ? '\n全部验证通过' : `\n${failures} 项验证失败`);
process.exit(failures === 0 ? 0 : 1);
