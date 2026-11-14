// 海边温室模拟核心 —— 纯逻辑，无 DOM 依赖，Node 与浏览器通用。
(function (root, factory) {
  const Sim = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
  else root.GreenhouseSim = Sim;
})(typeof self !== 'undefined' ? self : this, function () {
  const ZONES = 3;
  const DURATION = 1200; // 20 分钟（模拟秒）
  // 三块种植区的目标湿度带（%）
  const TARGETS = [
    { lo: 55, hi: 65, name: '叶菜区' },
    { lo: 68, hi: 78, name: '育苗区' },
    { lo: 45, hi: 55, name: '果菜区' },
  ];
  const MAINT_TIME = 45; // 一次检修耗时（模拟秒）
  const RUST_RATE = 0.35; // 腐蚀速率：% / 秒 / 单位盐雾

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  // 设备效率：腐蚀 0% -> 1.0，腐蚀 100% -> 0（停转）
  function eff(corrosion) { return Math.max(0, 1 - corrosion / 100); }

  function createState() {
    return {
      t: 0,
      fog: [0.35, 0.2, 0.1],       // 盐雾浓度（0~1.5），左侧靠海最高
      humidity: [60, 72, 50],      // 各区湿度 %
      temp: 24,
      health: [100, 100, 100],     // 作物健康
      disease: [0, 0, 0],          // 病害程度
      corrosion: { fan: 0, curtain: 0, valve: [0, 0, 0] },
      fan: { on: true, speed: 1 }, // 除雾风机，档位 1~2
      curtain: { closed: false },  // 遮阳帘
      valve: [{ open: false }, { open: false }, { open: false }], // 滴灌阀
      maint: { active: false, remaining: 0, done: 0 },
      stopped: { fan: false, curtain: false, valve: [false, false, false] },
      events: [],
      over: false,
      win: false,
      failReason: null,
    };
  }

  // 日照曲线：模拟中段正午最强
  function sunAt(t) { return Math.max(0, Math.sin(Math.PI * t / DURATION)); }

  // 盐雾涌浪：两次海风增强事件
  function fogSurgeAt(t) {
    const g = (c, w) => Math.exp(-((t - c) * (t - c)) / (2 * w * w));
    return 0.10 * g(420, 70) + 0.14 * g(900, 80);
  }

  function log(s, msg) {
    s.events.push({ t: Math.round(s.t), msg });
    if (s.events.length > 200) s.events.shift();
  }

  function startMaintenance(s) {
    if (s.maint.active || s.over) return false;
    s.maint.active = true;
    s.maint.remaining = MAINT_TIME;
    log(s, '检修开始：全部设备停机 ' + MAINT_TIME + ' 秒');
    return true;
  }

  function avgFog(s) { return (s.fog[0] + s.fog[1] + s.fog[2]) / 3; }

  function fanPower(s) {
    if (s.maint.active || !s.fan.on) return 0;
    return eff(s.corrosion.fan) * s.fan.speed;
  }

  function step(s, dt) {
    if (s.over) return;
    dt = dt || 0.5;
    const offline = s.maint.active;

    // ---- 检修进度 ----
    if (s.maint.active) {
      s.maint.remaining -= dt;
      if (s.maint.remaining <= 0) {
        s.maint.active = false;
        s.maint.done++;
        s.corrosion.fan = 0;
        s.corrosion.curtain = 0;
        s.corrosion.valve = [0, 0, 0];
        log(s, '检修完成（第 ' + s.maint.done + ' 次）：锈蚀已清除');
      }
    }

    // ---- 温度 ----
    const sun = sunAt(s.t);
    const shade = s.curtain.closed && !offline ? eff(s.corrosion.curtain) : 0;
    const tempTarget = 20 + sun * (13 - 8 * shade);
    s.temp += (tempTarget - s.temp) * 0.02 * dt;

    // ---- 盐雾扩散（左岸入海，风机在右侧排气）----
    const fp = fanPower(s);
    const inflow = 0.045 + fogSurgeAt(s.t);
    const D = 0.10;             // 区间扩散系数
    const rem = 0.22 * fp;      // 风机排雾强度
    const f = s.fog;
    const nf = [0, 0, 0];
    nf[0] = f[0] + (inflow * (1.3 - f[0]) + D * (f[1] - f[0]) - rem * 0.5 * f[0]) * dt;
    nf[1] = f[1] + (D * (f[0] - f[1]) + D * (f[2] - f[1]) - rem * 0.8 * f[1]) * dt;
    nf[2] = f[2] + (D * (f[1] - f[2]) - rem * 1.3 * f[2]) * dt;
    for (let i = 0; i < ZONES; i++) s.fog[i] = clamp(nf[i], 0, 1.5);

    // ---- 腐蚀（盐雾浓度越高锈蚀越快）----
    const af = avgFog(s);
    s.corrosion.fan = clamp(s.corrosion.fan + RUST_RATE * 1.6 * af * dt, 0, 100);
    s.corrosion.curtain = clamp(s.corrosion.curtain + RUST_RATE * 0.6 * af * dt, 0, 100);
    for (let i = 0; i < ZONES; i++) {
      s.corrosion.valve[i] = clamp(s.corrosion.valve[i] + RUST_RATE * 0.6 * s.fog[i] * dt, 0, 100);
    }
    // 设备停转判定（只记录一次）
    if (!s.stopped.fan && s.corrosion.fan >= 100) {
      s.stopped.fan = true;
      log(s, '⚠ 除雾风机锈蚀停转！');
    }
    if (!s.stopped.curtain && s.corrosion.curtain >= 100) {
      s.stopped.curtain = true;
      log(s, '⚠ 遮阳帘轨道锈死！');
    }
    for (let i = 0; i < ZONES; i++) {
      if (!s.stopped.valve[i] && s.corrosion.valve[i] >= 100) {
        s.stopped.valve[i] = true;
        log(s, '⚠ ' + TARGETS[i].name + '滴灌阀锈死！');
      }
    }

    // ---- 湿度：滴灌加水，蒸发与风机排湿 ----
    for (let i = 0; i < ZONES; i++) {
      const vEff = offline || !s.valve[i].open ? 0 : eff(s.corrosion.valve[i]);
      const drip = 0.32 * vEff;
      const evap = 0.011 * Math.max(0, s.temp - 16);
      const vent = 0.09 * fp;
      s.humidity[i] = clamp(s.humidity[i] + (drip - evap - vent) * dt, 5, 100);
    }

    // ---- 病害与健康 ----
    for (let i = 0; i < ZONES; i++) {
      const h = s.humidity[i];
      if (h > 85) {
        if (s.disease[i] === 0) log(s, TARGETS[i].name + '湿度过高，病害爆发！');
        s.disease[i] = clamp(s.disease[i] + 0.6 * dt, 0, 100);
      } else if (h < 78) {
        s.disease[i] = Math.max(0, s.disease[i] - 0.25 * dt);
      }
      const tg = TARGETS[i];
      let dh;
      if (h < tg.lo) dh = -(tg.lo - h) * 0.02;
      else if (h > tg.hi) dh = -(h - tg.hi) * 0.02;
      else dh = 0.06; // 处于目标带缓慢恢复
      dh -= s.disease[i] * 0.02;
      s.health[i] = clamp(s.health[i] + dh * dt, 0, 100);
      if (s.health[i] <= 0 && !s.over) {
        s.over = true;
        s.win = false;
        s.failReason = TARGETS[i].name + '作物枯死';
        log(s, '✖ ' + s.failReason + '，模拟失败');
      }
    }

    // ---- 结算 ----
    s.t += dt;
    if (!s.over && s.t >= DURATION) {
      s.over = true;
      const alive = s.health.every(h => h > 0);
      if (alive && s.maint.done >= 1) {
        s.win = true;
        log(s, '✔ 20 分钟稳态运行达成，且完成检修，通过！');
      } else {
        s.win = false;
        s.failReason = s.maint.done < 1 ? '未完成任何检修' : '作物未能存活';
        log(s, '✖ 模拟结束：' + s.failReason);
      }
    }
  }

  return {
    ZONES, DURATION, TARGETS, MAINT_TIME,
    createState, step, startMaintenance,
    sunAt, fogSurgeAt, eff, fanPower, avgFog,
  };
});
