// 无头验证：稳态运行应通过；忽略腐蚀（不检修）应导致设备停转。
const Sim = require('./sim.js');

const DT = 0.5;

// 通用控制策略：风机除雾、遮阳帘控温、滴灌阀滞环控湿
function control(s, doMaintain) {
  // 风机：平均盐雾高则加档
  s.fan.on = true;
  s.fan.speed = Sim.avgFog(s) > 0.45 ? 2 : 1;
  // 遮阳帘：日照强时关闭
  s.curtain.closed = Sim.sunAt(s.t) > 0.55;
  // 滴灌阀：滞环保持在目标带内
  for (let i = 0; i < Sim.ZONES; i++) {
    const tg = Sim.TARGETS[i];
    const h = s.humidity[i];
    if (!s.valve[i].open && h < tg.lo + 2) s.valve[i].open = true;
    if (s.valve[i].open && h > tg.hi - 2) s.valve[i].open = false;
  }
  // 检修：任一设备锈蚀过半即安排
  if (doMaintain && !s.maint.active) {
    const worst = Math.max(
      s.corrosion.fan, s.corrosion.curtain,
      s.corrosion.valve[0], s.corrosion.valve[1], s.corrosion.valve[2]
    );
    if (worst > 55) Sim.startMaintenance(s);
  }
}

function run(doMaintain, verbose) {
  const s = Sim.createState();
  let fanStopT = null;
  while (!s.over) {
    control(s, doMaintain);
    Sim.step(s, DT);
    if (s.stopped.fan && fanStopT === null) fanStopT = s.t;
    if (verbose && Math.abs(s.t % 120) < DT) {
      console.log(
        '  t=' + String(Math.round(s.t)).padStart(4) + 's',
        'fog=[' + s.fog.map(x => x.toFixed(2)).join(',') + ']',
        'hum=[' + s.humidity.map(x => x.toFixed(0)).join(',') + ']',
        'rust fan=' + s.corrosion.fan.toFixed(0) + '%',
        'valve=[' + s.corrosion.valve.map(x => x.toFixed(0)).join(',') + ']',
        'hp=[' + s.health.map(x => x.toFixed(0)).join(',') + ']',
        'maint=' + s.maint.done
      );
    }
  }
  return { s, fanStopT };
}

let failures = 0;
function check(cond, msg) {
  console.log((cond ? '  PASS ' : '  FAIL ') + msg);
  if (!cond) failures++;
}

console.log('=== 场景 A：稳态运行（正常除雾 + 控湿 + 检修）===');
const a = run(true, true);
console.log('  结果: win=' + a.s.win, 'maint=' + a.s.maint.done,
  'hp=[' + a.s.health.map(x => x.toFixed(0)).join(',') + ']');
check(a.s.over && a.s.t >= Sim.DURATION, '模拟跑满 20 分钟');
check(a.s.win === true, '作物全部存活且判定通过');
check(a.s.maint.done >= 1, '至少完成一次检修');
check(a.s.health.every(h => h > 0), '三区作物健康均大于 0');

console.log('=== 场景 B：忽略腐蚀（从不检修）===');
const b = run(false, true);
console.log('  结果: win=' + b.s.win, 'failReason=' + b.s.failReason,
  'fanStopT=' + (b.fanStopT === null ? '未停转' : Math.round(b.fanStopT) + 's'));
check(b.s.stopped.fan === true, '除雾风机锈蚀至 100% 停转');
check(Sim.fanPower(b.s) === 0, '停转后风机输出功率为 0');
check(b.fanStopT !== null && b.fanStopT < Sim.DURATION, '停转发生在 20 分钟内');
check(b.s.win === false, '忽略腐蚀时无法通过模拟');

console.log(failures === 0 ? '\n全部验证通过 ✔' : '\n存在失败项 ✖ (' + failures + ')');
process.exit(failures === 0 ? 0 : 1);
