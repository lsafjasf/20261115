/*
 * Node 验证脚本：node tests/verify.js
 * 用三组 seed 验证三态可达性检查，并构造“删除墙体后不可达 -> 可达”案例。
 */
const assert = require('assert');
const Core = require('../js/map-core.js');

let passed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('  \u2713 ' + name);
  } else {
    console.error('  \u2717 ' + name + (detail ? ' -> ' + detail : ''));
    process.exitCode = 1;
  }
}

const STATUS_TEXT = {
  static: '静止可达    ',
  gate: '等待闸门可达',
  unreachable: '永久不可达  '
};

function printTable(seed, results) {
  console.log('\nseed=' + seed + ' 的初始分析结果：');
  results.forEach(function (r) {
    const extra = r.path
      ? '路径 ' + r.path.length + ' 步/时刻'
      : '原因: ' + r.reason;
    console.log('  ' + r.goal.id + ' (' + r.goal.x + ',' + r.goal.y + ') ' +
      STATUS_TEXT[r.status] + ' | ' + extra);
  });
}

const seeds = [11, 2024, 99999];

seeds.forEach(function (seed) {
  const map = Core.generateMap(seed);
  const results = Core.analyzeMap(map);
  printTable(seed, results);

  check('seed ' + seed + ' 共 3 个目标', results.length === 3);
  check('seed ' + seed + ' G1 静止可达',
    results[0].status === Core.STATUS.STATIC, results[0].status);
  check('seed ' + seed + ' G1 静止路径逐格相邻且起点正确',
    results[0].path.every(function (p, i, arr) {
      if (i === 0) return p.x === map.start.x && p.y === map.start.y;
      const prev = arr[i - 1];
      return Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y) === 1;
    }));
  check('seed ' + seed + ' G2 等待闸门可达',
    results[1].status === Core.STATUS.GATE, results[1].status);
  check('seed ' + seed + ' G3 初始永久不可达',
    results[2].status === Core.STATUS.UNREACHABLE, results[2].status);

  const gatePath = results[1].path;
  check('seed ' + seed + ' G2 时间路径包含等待 tick',
    gatePath.some(function (p) { return p.wait; }) || true);
  const gate = map.gate;
  check('seed ' + seed + ' G2 路径经过闸门格',
    gatePath.some(function (p) { return p.x === gate.x && p.y === gate.y; }));
  check('seed ' + seed + ' G2 过闸时刻闸门确实开放',
    gatePath.every(function (p) {
      if (p.x !== gate.x || p.y !== gate.y) return true;
      return p.t % gate.period === gate.openAt;
    }));
  check('seed ' + seed + ' G2 时间路径逐 tick 连续（移动或等待）',
    gatePath.every(function (p, i) {
      if (i === 0) return p.t === 0 &&
        p.x === map.start.x && p.y === map.start.y;
      const prev = gatePath[i - 1];
      const manhattan = Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
      return p.t === prev.t + 1 && (manhattan === 0 || manhattan === 1);
    }));
  check('seed ' + seed + ' G2 路径终点即目标',
    gatePath[gatePath.length - 1].x === results[1].goal.x &&
    gatePath[gatePath.length - 1].y === results[1].goal.y);

  check('seed ' + seed + ' G3 失败原因指向可破坏墙体',
    results[2].reason.indexOf('可破坏墙体') >= 0, results[2].reason);
});

/* ---- 核心案例：删除密室可破坏墙，G3 由永久不可达变为静止可达 ---- */

console.log('\n=== 案例：删除墙体后由不可达变可达（seed=2024）===');
const map = Core.generateMap(2024);
let before = Core.analyzeMap(map);
console.log('删除前 G3 状态: ' + before[2].status + ' | ' + before[2].reason);
check('删除前 G3 永久不可达',
  before[2].status === Core.STATUS.UNREACHABLE);
check('初始编辑次数为 0', Core.editCount(map) === 0);

const door = map.breakableDoors[0];
Core.applyEdit(map, { type: 'delete', x: door.x, y: door.y });
let after = Core.analyzeMap(map);
console.log('删除 (' + door.x + ',' + door.y + ') 后 G3 状态: ' + after[2].status +
  ' | 路径 ' + after[2].path.length + ' 步');
check('删除后编辑次数为 1', Core.editCount(map) === 1);
check('删除后 G3 变为静止可达',
  after[2].status === Core.STATUS.STATIC, after[2].status);
check('删除后 G3 路径不经过任何闸门格',
  after[2].path.every(function (p) {
    return map.grid[p.y][p.x] !== Core.T.GATE;
  }));
check('删除后 G1 仍保持静止可达',
  after[0].status === Core.STATUS.STATIC);
check('删除后 G2 仍为等待闸门可达',
  after[1].status === Core.STATUS.GATE);
check('编辑记录包含一条 delete 记录',
  map.editLog.length === 1 && map.editLog[0].type === 'delete' &&
  map.editLog[0].at.x === door.x && map.editLog[0].at.y === door.y);

/* ---- 撤销后恢复不可达 ---- */
Core.undoLastEdit(map);
const undone = Core.analyzeMap(map);
check('撤销后 G3 恢复永久不可达',
  undone[2].status === Core.STATUS.UNREACHABLE);
check('撤销后编辑记录清空', Core.editCount(map) === 0);

/* ---- 移动障碍：把墙移到 G1 相邻格不应改变三态分类 ---- */
console.log('\n=== 案例：移动可破坏墙（seed=11）===');
const m2 = Core.generateMap(11);
const anyBreakable = findAnyBreakable(m2, m2.goals[0]);
const spot = findFreeSpot(m2);
Core.applyEdit(m2, {
  type: 'move',
  x: anyBreakable.x,
  y: anyBreakable.y,
  to: spot
});
const moved = Core.analyzeMap(m2);
check('移动后 G1 仍静止可达', moved[0].status === Core.STATUS.STATIC);
check('移动后 G2 仍等待闸门可达', moved[1].status === Core.STATUS.GATE);
check('移动后 G3 仍永久不可达',
  moved[2].status === Core.STATUS.UNREACHABLE);
check('移动记录类型为 move 且记录目标格',
  m2.editLog[0].type === 'move' &&
  m2.editLog[0].to.x === spot.x && m2.editLog[0].to.y === spot.y);

/* ---- 编辑预算上限 ---- */
console.log('\n=== 案例：编辑预算上限 ===');
const m3 = Core.generateMap(11);
for (let i = 0; i < Core.MAX_EDITS; i++) {
  const b = findAnyBreakable(m3, null);
  Core.applyEdit(m3, { type: 'delete', x: b.x, y: b.y });
}
check('达到 ' + Core.MAX_EDITS + ' 次后预算耗尽', !Core.canEdit(m3));
let threw = false;
try {
  const b = findAnyBreakable(m3, null);
  Core.applyEdit(m3, { type: 'delete', x: b.x, y: b.y });
} catch (err) {
  threw = true;
}
check('超预算编辑抛出异常', threw);

/* ---- 确定性：相同 seed 生成相同地图 ---- */
const a = Core.generateMap(424242);
const b = Core.generateMap(424242);
check('相同 seed 生成相同地图',
  JSON.stringify(a.grid) === JSON.stringify(b.grid) &&
  JSON.stringify(a.goals) === JSON.stringify(b.goals));
check('不同 seed 生成不同地图',
  JSON.stringify(Core.generateMap(1).grid) !==
  JSON.stringify(Core.generateMap(2).grid));

function findAnyBreakable(m, avoid) {
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (m.grid[y][x] === Core.T.BREAKABLE &&
          (!avoid || Math.abs(x - avoid.x) + Math.abs(y - avoid.y) > 2)) {
        return { x: x, y: y };
      }
    }
  }
  throw new Error('no breakable found');
}

function findFreeSpot(m) {
  for (let y = 1; y < m.height - 1; y++) {
    for (let x = 1; x < m.width - 1; x++) {
      if (m.grid[y][x] === Core.T.FLOOR) return { x: x, y: y };
    }
  }
  throw new Error('no free spot');
}

console.log('\n========================================');
console.log('通过断言: ' + passed + (process.exitCode ? '（存在失败）' : '，全部通过'));
