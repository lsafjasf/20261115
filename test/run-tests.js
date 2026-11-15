/*
 * Node 测试：
 *  场景1 双人同时输入，正确顺序完成三组设备检修并保持安全 → won
 *  场景2 错误顺序（泵启动但闸门全关）→ 过压爆管 → failed/overpressure
 *  场景3 泵运行中带载切换继电器 → 电压瞬态越限
 */
'use strict';
var Sim = require('../src/sim.js');

var failures = 0;

function check(name, cond, detail) {
  if (cond) {
    console.log('  PASS  ' + name);
  } else {
    failures++;
    console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : ''));
  }
}

// 按脚本推进仿真：script = [[时刻, 按键或按键数组], ...]
function runScript(sim, script, tEnd, dt) {
  dt = dt || 0.05;
  var idx = 0;
  while (sim.getState().t < tEnd && sim.getState().status === 'running') {
    var t = sim.getState().t;
    while (idx < script.length && script[idx][0] <= t) {
      var keys = Array.isArray(script[idx][1]) ? script[idx][1] : [script[idx][1]];
      sim.pressMany(keys); // 同一拍同时输入
      idx++;
    }
    sim.step(dt);
  }
  return sim.getState();
}

function eventsOf(sim, type) {
  return sim.events.filter(function (e) { return e.type === type; });
}

/* ---------- 场景1：同时输入 + 正确顺序 → 检修成功 ---------- */
console.log('\n[场景1] 双人同时输入，完成三组检修并保持安全');
var fast = { restoreTime: 2, holdTime: 6 }; // 压缩时间参数，逻辑与正式版一致
var sim1 = Sim.createSim(fast);
var st1 = runScript(sim1, [
  [0.5, 'breaker'],                       // B: 合主断路器
  [1.0, ['relay1', 'gate1']],             // B 吸合继电器1 的同时 A 开闸门1
  [1.5, ['relay2', 'relay3', 'pump']],    // B 吸合继电器2/3 的同时 A 启动泵
  [3.0, 'gate2'],                         // A: 开闸门2（双闸泄压 ≈ 泵流量）
  [7.0, 'gate3'],                         // A: 开闸门3，轮换恢复组3
  [8.5, 'gate1']                          // A: 关闸门1，保持两闸开度维持压力
], 60);

check('三人同时输入被记录', eventsOf(sim1, 'sync').length >= 2,
  JSON.stringify(eventsOf(sim1, 'sync')));
check('设备组1恢复', st1.groups[0].restored);
check('设备组2恢复', st1.groups[1].restored);
check('设备组3恢复', st1.groups[2].restored);
check('安全保持计时完成', st1.hold >= 6, 'hold=' + st1.hold.toFixed(2));
check('任务成功 won', st1.status === 'won', 'status=' + st1.status);
check('全程未过压', st1.pressure <= 10, 'P=' + st1.pressure.toFixed(2));

/* ---------- 场景2：错误顺序 → 过压 ---------- */
console.log('\n[场景2] 错误顺序：闸门全关即启动泵 → 过压爆管');
var sim2 = Sim.createSim(fast);
var st2 = runScript(sim2, [
  [0.5, 'breaker'],
  [1.0, 'relay1'],
  [1.5, 'pump']   // 错误：未开任何闸门就启泵，压力只进不出
], 60);

check('任务失败', st2.status === 'failed', 'status=' + st2.status);
check('失败原因为过压', st2.failReason === 'overpressure', st2.failReason);
check('过压事件已记录', eventsOf(sim2, 'overpressure').length === 1);
check('爆管压力超过阈值', st2.pressure > 10, 'P=' + st2.pressure.toFixed(2));

/* ---------- 场景3：带载切换继电器 → 电压瞬态越限 ---------- */
console.log('\n[场景3] 泵运行中带载切换继电器 → 电压越限告警');
var sim3 = Sim.createSim(fast);
runScript(sim3, [
  [0.5, 'breaker'],
  [1.0, ['relay1', 'relay2', 'relay3']],
  [1.5, ['pump', 'gate1']],
  [3.0, 'gate2'],
  [8.0, 'relay3']   // 泵运行中释放继电器3 → +55V 瞬态
], 12);
var st3 = sim3.getState();
check('出现电压瞬态事件', eventsOf(sim3, 'spike').length >= 1);
check('电压越限被检出', eventsOf(sim3, 'volt_bad').length >= 1,
  JSON.stringify(eventsOf(sim3, 'volt_bad')));
check('任务未因瞬态直接失败', st3.status === 'running', st3.status);

console.log('\n' + (failures ? failures + ' 项失败' : '全部通过'));
process.exit(failures ? 1 : 0);
