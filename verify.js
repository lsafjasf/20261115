/* 无头验证：完整跑通一次红蓝套准调准，并验证撤销上一次修正后套偏复现 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createSimulator, CONSTANTS } = require('./engine');

const SEED = 20261115;
const C = CONSTANTS;
const sim = createSimulator(SEED);
const log = [];
const assertions = [];

function record(tag, sheet) {
  const m = sheet.measured;
  const t = sheet.trueError;
  const d = sheet.density;
  const k = sheet.checks;
  const line =
    `第 ${String(sheet.index).padStart(2, '0')} 张 [${tag}] ` +
    `测量 X=${m.x.toFixed(1)}μm Y=${m.y.toFixed(1)}μm ` +
    `真值 X=${t.x.toFixed(1)} Y=${t.y.toFixed(1)} ` +
    `浓度 红=${d.red.toFixed(3)} 蓝=${d.blue.toFixed(3)} ` +
    `重影=${sheet.ghost.toFixed(3)} ` +
    `判定=${sheet.qualified ? '合格' : '不合格'} ` +
    `(套准${k.registration ? '✓' : '✗'} 油墨${k.ink ? '✓' : '✗'} ` +
    `重影${k.ghost ? '✓' : '✗'}) 连续合格=${sheet.streak}`;
  log.push(line);
  console.log(line);
}

function densityDelta(value) {
  if (value < C.DENSITY_MIN) return +((C.DENSITY_TARGET - value) * 0.45).toFixed(3);
  if (value > C.DENSITY_MAX) return -+((value - C.DENSITY_TARGET) * 0.45).toFixed(3);
  return 0;
}

function correctionFor(sheet) {
  const m = sheet.measured;
  const gain = 0.8;
  return {
    dx: Math.abs(m.x) > C.TOLERANCE_UM ? -Math.round(m.x * gain) : 0,
    dy: Math.abs(m.y) > C.TOLERANCE_UM ? -Math.round(m.y * gain) : 0,
    dRed: densityDelta(sheet.density.red),
    dBlue: densityDelta(sheet.density.blue),
  };
}

function assert(name, cond, detail) {
  assertions.push({ name, pass: !!cond, detail: detail || '' });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

/* 阶段 1：首张样张 —— 初始红蓝套偏与油墨浓度均不合格 */
const first = sim.reprint();
record('初始样张', first);
assert('初始样张套偏超出 ±50μm 容差',
  Math.abs(first.measured.x) > C.TOLERANCE_UM ||
  Math.abs(first.measured.y) > C.TOLERANCE_UM,
  `测量 X=${first.measured.x.toFixed(1)} Y=${first.measured.y.toFixed(1)}`);
assert('初始样张油墨浓度不合格', !first.checks.ink);

/* 阶段 2：过度调整 —— 大幅反向修正，产生明显重影 */
sim.applyCorrection({ dx: -420, dy: 260, dRed: 0.3, dBlue: -0.35 });
const overshootSheet = sim.reprint();
record('过度调整', overshootSheet);
assert('过度调整触发明显重影并超差',
  !overshootSheet.checks.ghost && overshootSheet.ghost >= C.GHOST_LIMIT,
  `重影指数=${overshootSheet.ghost.toFixed(3)}`);

/* 阶段 3：按放大镜测量逐步收敛，直到连续 10 张稳定合格 */
let lastConvergeCorrection = null;
let guard = 0;
while (!sim.getState().complete && guard < 80) {
  guard += 1;
  const sheet = sim.getState().lastSheet;
  if (!sheet.qualified) {
    const delta = correctionFor(sheet);
    lastConvergeCorrection = {
      sheetIndex: sheet.index,
      measuredBefore: { x: sheet.measured.x, y: sheet.measured.y },
      delta,
    };
    sim.applyCorrection(delta);
    console.log(`  ↳ 第${sheet.index}张后修正: dx=${delta.dx}μm dy=${delta.dy}μm ` +
      `红浓度${delta.dRed} 蓝浓度${delta.dBlue}`);
  }
  record('逐步调准', sim.reprint());
}

const alignedState = sim.getState();
assert('连续 10 张稳定合格后任务完成', alignedState.complete,
  `连续合格=${alignedState.streak} 总印张=${alignedState.sheetCount}`);
assert('达标时重影低于上限', alignedState.ghost < C.GHOST_LIMIT,
  `重影指数=${alignedState.ghost.toFixed(3)}`);
assert('达标时套准真值在容差内',
  Math.abs(alignedState.netError.x) <= C.TOLERANCE_UM &&
  Math.abs(alignedState.netError.y) <= C.TOLERANCE_UM,
  `真值 X=${alignedState.netError.x.toFixed(1)} Y=${alignedState.netError.y.toFixed(1)}`);
assert('达标时油墨浓度在合格区间',
  alignedState.density.red >= C.DENSITY_MIN && alignedState.density.red <= C.DENSITY_MAX &&
  alignedState.density.blue >= C.DENSITY_MIN && alignedState.density.blue <= C.DENSITY_MAX);

/* 阶段 4：受控环境下做一次决定性修正（模拟换版后重新出现的明显套偏），
   随后撤销，验证版位精确回到修正前且套偏重新出现。 */
const controlled = createSimulator(SEED);
const ctrlFirst = controlled.reprint();
record('受控环境首印', ctrlFirst);
const preFixState = controlled.getState();
const preFixNet = controlled.netError();
assert('受控环境初始套偏显著超差（决定性修正的前提）',
  Math.abs(preFixNet.x) >= 200 && Math.abs(preFixNet.y) >= 120,
  `真值 X=${preFixNet.x.toFixed(1)} Y=${preFixNet.y.toFixed(1)}`);

const fixDelta = {
  dx: -Math.round(preFixNet.x),
  dy: -Math.round(preFixNet.y),
  dRed: +(C.DENSITY_TARGET - ctrlFirst.density.red).toFixed(3),
  dBlue: +(C.DENSITY_TARGET - ctrlFirst.density.blue).toFixed(3),
};
controlled.applyCorrection(fixDelta);
const fixedSheet = controlled.reprint();
record('决定性修正后', fixedSheet);
assert('决定性修正后套准进入容差', fixedSheet.checks.registration,
  `测量 X=${fixedSheet.measured.x.toFixed(1)} Y=${fixedSheet.measured.y.toFixed(1)}`);
assert('决定性修正后油墨浓度合格', fixedSheet.checks.ink);

controlled.undo();
const undoneState = controlled.getState();
const undoSheet = controlled.reprint();
record('撤销后重印', undoSheet);

assert('撤销后版位真值精确回到修正前',
  Math.abs(undoneState.machine.x - preFixState.machine.x) < 1e-9 &&
  Math.abs(undoneState.machine.y - preFixState.machine.y) < 1e-9 &&
  Math.abs(undoneState.correction.x - preFixState.correction.x) < 1e-9 &&
  Math.abs(undoneState.correction.y - preFixState.correction.y) < 1e-9,
  `修正前 net=(${preFixNet.x.toFixed(1)}, ${preFixNet.y.toFixed(1)}) ` +
  `撤销后 net=(${undoSheet.trueError.x.toFixed(1)}, ${undoSheet.trueError.y.toFixed(1)})`);
assert('撤销上一次修正后套偏（测量值）重新出现',
  !undoSheet.checks.registration,
  `测量 X=${undoSheet.measured.x.toFixed(1)}μm Y=${undoSheet.measured.y.toFixed(1)}μm，` +
  `容差 ±${C.TOLERANCE_UM}μm`);
assert('撤销后真值套偏同样超差',
  Math.abs(undoSheet.trueError.x) > C.TOLERANCE_UM ||
  Math.abs(undoSheet.trueError.y) > C.TOLERANCE_UM,
  `真值 X=${undoSheet.trueError.x.toFixed(1)} Y=${undoSheet.trueError.y.toFixed(1)}`);
assert('撤销后油墨浓度回到修正前的不合格状态',
  Math.abs(undoSheet.density.red - ctrlFirst.density.red) < 1e-9);
assert('撤销后任务处于未完成状态', !undoSheet.complete);

const allPass = assertions.every((a) => a.pass);
const report = {
  seed: SEED,
  timestamp: new Date().toISOString(),
  totalSheets: sim.getState().sheetCount + controlled.getState().sheetCount,
  assertions,
  allPass,
  log,
  detail: {
    firstSheet: first,
    overshootSheet,
    alignedState,
    lastConvergeCorrection,
    controlledFirstSheet: ctrlFirst,
    controlledFix: { preFixState, fixDelta, fixedSheet },
    sheetAfterUndo: undoSheet,
  },
};

const outDir = path.join(__dirname, 'artifacts');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'verification-report.json'),
  JSON.stringify(report, null, 2)
);
console.log('\n报告已写入 artifacts/verification-report.json');
console.log(allPass ? '\n全部断言通过 ✔' : '\n存在失败断言 ✘');
process.exit(allPass ? 0 : 1);
