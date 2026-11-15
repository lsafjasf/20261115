/* 验证：调整轮廓 -> 生成网格 -> 导出 pot.obj -> 重新载入 -> 校验
 * 运行：node verify.js */
'use strict';
const fs = require('fs');
const Pot = require('./pot.js');

const SEG = Pot.DEFAULT_SEGMENTS;
const profile = Pot.defaultProfile();

// ---- 模拟用户拖动轮廓点 ----
profile[2].r = 1.32;            // 腹部外扩
profile[3].h = 1.52;            // 肩部抬高
profile[4].r = 0.36;            // 颈部收细
profile[5].r = 0.74;            // 瓶口外撇
profile[5].h = 2.2;             // 瓶口抬高
console.log('调整后轮廓:', profile.map(p => `${p.name}(r=${p.r},h=${p.h})`).join(' '));

const mesh = Pot.buildMesh(profile, SEG);
fs.writeFileSync('pot.obj', Pot.toOBJ(mesh, 'pot_adjusted'));
const loaded = Pot.parseOBJ(fs.readFileSync('pot.obj', 'utf8'));

let failures = 0;
function check(label, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? '  — ' + detail : ''));
  if (!ok) failures++;
}

// 1. 顶点数 = 环数 × 分段数 + 底心
const expectV = profile.length * SEG + 1;
const gotV = loaded.positions.length / 3;
check('顶点数量', gotV === expectV, `期望 ${expectV}，实际 ${gotV}`);

// 2. 三角形数 = 底扇 SEG + 侧面 (rings-1)*SEG*2
const expectF = SEG + (profile.length - 1) * SEG * 2;
check('三角形数量', loaded.faces.length === expectF, `期望 ${expectF}，实际 ${loaded.faces.length}`);

// 3. 重新载入后顶点坐标一致
let maxDiff = 0;
for (let i = 0; i < mesh.positions.length; i++) {
  maxDiff = Math.max(maxDiff, Math.abs(loaded.positions[i] - mesh.positions[i]));
}
check('重载形状一致', maxDiff < 1e-5, `最大坐标偏差 ${maxDiff.toExponential(2)}`);

// 4. 边界：仅瓶口一圈 SEG 条边，且全部位于最高环
const boundary = Pot.boundaryEdges(loaded.faces);
const maxH = Math.max(...profile.map(p => p.h));
const rimOk = boundary.every(e => e.every(v => Math.abs(loaded.positions[v * 3 + 1] - maxH) < 1e-6));
check('边界边数量', boundary.length === SEG, `期望 ${SEG}（瓶口一圈），实际 ${boundary.length}`);
check('边界即瓶口环', rimOk, boundary.length + ' 条边界边全部位于 h=' + maxH);

// 5. 法线朝外（旋转不翻面）：侧面法线·径向 > 0，底面法线朝下
const bottomCenter = profile.length * SEG;
let outward = true;
for (const f of loaded.faces) {
  const n = Pot.faceNormal(loaded.positions, f);
  if (f.indexOf(bottomCenter) >= 0) { if (n[1] >= 0) outward = false; continue; } // 底面
  const c = [0, 0, 0];
  for (const v of f) {
    c[0] += loaded.positions[v * 3] / 3;
    c[1] += loaded.positions[v * 3 + 1] / 3;
    c[2] += loaded.positions[v * 3 + 2] / 3;
  }
  const radial = Math.hypot(c[0], c[2]);
  if ((n[0] * c[0] + n[2] * c[2]) / radial <= 0) outward = false;
}
check('法线全部朝外', outward, '侧面径向点积 > 0，底面法线朝下');

// 6. 无退化三角形
let degenerate = 0;
for (const f of loaded.faces) {
  const n = Pot.faceNormal(loaded.positions, f);
  if (!isFinite(n[0]) || !isFinite(n[1]) || !isFinite(n[2])) degenerate++;
}
check('无退化三角形', degenerate === 0, degenerate + ' 个退化面');

console.log(failures === 0 ? '\n全部通过 ✔  输出文件: pot.obj' : '\n有 ' + failures + ' 项失败');
process.exit(failures === 0 ? 0 : 1);
