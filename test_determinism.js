// 确定性测试：同一 seed 重载后光带形状一致；不同 seed 形状不同。
const core = require("./aurora.js");

const params = Object.assign({}, core.DEFAULTS, { time: 0.37 });

function shapeVector(seed) {
  const v = [];
  for (let b = 0; b < core.BAND_COUNT; b++) {
    for (let i = 0; i <= 200; i++) {
      const s = core.bandShape(b, i / 200, params, seed);
      v.push(s.top, s.bottom, s.intensity);
    }
  }
  return v;
}

function maxDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

// 1) 同一 seed 两次“载入” -> 必须完全一致
const run1 = shapeVector(params.seedA);
const run2 = shapeVector(params.seedA);
const reloadDiff = maxDiff(run1, run2);
console.log("重载一致性 maxDiff =", reloadDiff);
console.assert(reloadDiff === 0, "FAIL: 同一 seed 两次计算不一致");

// 2) 不同 seed -> 形状应显著不同
const other = shapeVector(params.seedB);
const seedDiff = maxDiff(run1, other);
console.log("seedA vs seedB maxDiff =", seedDiff.toFixed(4));
console.assert(seedDiff > 0.001, "FAIL: 不同 seed 形状无差异");

// 3) 噪声边界与值域
const fbm = core.makeFbm(123, 4);
let ok = true;
for (let x = 0; x < 50; x += 0.137) {
  const v = fbm(x);
  if (!(v >= 0 && v <= 1)) ok = false;
}
console.log("fbm 值域 [0,1] =", ok);
console.assert(ok, "FAIL: fbm 越界");

console.log(reloadDiff === 0 && seedDiff > 0.001 && ok
  ? "ALL TESTS PASSED" : "TESTS FAILED");
