/* 悬崖餐厅 · 悬挂餐车送餐 —— 纯逻辑核心（浏览器 / Node 通用） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CliffDining = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const W = 960, H = 600;
  const CABLE = { x0: 92, y0: 132, x1: 902, y1: 106, sag: 26 };
  const ROD_L = 106;
  const G = 540;
  const DAMP = 0.9;
  const V_MAX = 150;
  const V_MIN = -50;
  const ACCEL = 132;
  const ESTOP_RATE = 470;
  const TILT_LIMIT = 0.42;
  const JERK_LIMIT = 190;
  const TEMP_START = 90;
  const TEMP_AMBIENT = 18;
  const TEMP_MIN = 55;
  const COOL_K = 0.0075;
  const WIND_SCALE = 150;
  const ZONE_PX = 22;

  const DECKS = [
    { s: 0.22, side: 'left', name: '1号观景台' },
    { s: 0.52, side: 'right', name: '2号观景台' },
    { s: 0.85, side: 'left', name: '3号观景台' },
  ];

  const CABLE_LEN = (function () {
    let len = 0;
    let prev = cablePoint(0);
    for (let i = 1; i <= 200; i++) {
      const p = cablePoint(i / 200);
      len += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
    }
    return len;
  })();

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function moveToward(v, target, maxDelta) {
    if (Math.abs(target - v) <= maxDelta) return target;
    return v + Math.sign(target - v) * maxDelta;
  }

  function cablePoint(s) {
    const sag = CABLE.sag * Math.sin(Math.PI * clamp(s, 0, 1));
    return {
      x: CABLE.x0 + (CABLE.x1 - CABLE.x0) * s,
      y: CABLE.y0 + (CABLE.y1 - CABLE.y0) * s + sag,
    };
  }

  function cableTangent(s) {
    const a = cablePoint(clamp(s, 0, 1) - 0.001);
    const b = cablePoint(clamp(s, 1, 1) + 0.001);
    const m = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / m, y: (b.y - a.y) / m };
  }

  /* 风：多层慢正弦 + 周期性阵风，确定性、可复现 */
  function windAt(t) {
    const g = Math.sin(t * 0.13 + 0.9);
    const gust = g > 0.55 ? Math.pow((g - 0.55) / 0.45, 2) : 0;
    return 55 * Math.sin(t * 0.21 + 1.3)
      + 38 * Math.sin(t * 0.47)
      + 30 * Math.sin(t * 0.83 + 2.1)
      + 58 * gust * Math.sin(t * 1.1 + 1.7);
  }

  function createGame() {
    return {
      t: 0,
      s: 0,
      v: 0,
      theta: 0,
      omega: 0,
      wind: windAt(0),
      apAlong: 0,
      estopActive: false,
      nextDeck: 0,
      status: 'running',
      message: '出发！沿钢索把热菜送往观景台',
      messageT: 3,
      dishes: [0, 1, 2].map(() => ({ temp: TEMP_START, spill: 0, done: false, good: false })),
      deliveries: [],
      shake: 0,
    };
  }

  function activeDishes(g) {
    return g.dishes.filter((d) => !d.done);
  }

  function addSpill(g, amount) {
    const list = activeDishes(g);
    for (const d of list) d.spill = clamp(d.spill + amount, 0, 1);
  }

  function isEdible(d) {
    return d.spill < 0.98 && d.temp >= TEMP_MIN;
  }

  function inZone(g) {
    if (g.nextDeck >= DECKS.length) return false;
    return Math.abs((DECKS[g.nextDeck].s - g.s) * CABLE_LEN) <= ZONE_PX;
  }

  function isStable(g) {
    return Math.abs(g.v) <= 16 && Math.abs(g.theta) <= 0.12 && Math.abs(g.omega) <= 0.4;
  }

  function tryDeliver(g) {
    if (g.status !== 'running' || g.nextDeck >= DECKS.length) return false;
    if (!inZone(g)) {
      g.message = '未进入观景台投递区'; g.messageT = 1.6; return false;
    }
    if (!isStable(g)) {
      g.message = '车身还在晃，停稳再投递'; g.messageT = 1.6; return false;
    }
    const idx = g.nextDeck;
    const dish = g.dishes[idx];
    const deck = DECKS[idx];
    dish.done = true;
    dish.good = isEdible(dish);
    g.deliveries.push({
      deck: deck.name, t: g.t, temp: dish.temp, spill: dish.spill, good: dish.good,
    });
    g.nextDeck += 1;
    if (dish.good) {
      g.message = deck.name + ' 投递成功，菜品合格 ' + dish.temp.toFixed(1) + '℃';
    } else {
      g.message = deck.name + ' 已送达，但菜品' +
        (dish.temp < TEMP_MIN ? '已凉透' : '汤汁洒光');
    }
    g.messageT = 2.4;
    if (g.nextDeck >= DECKS.length) {
      const goods = g.dishes.filter((d) => d.good).length;
      g.status = goods >= 2 ? 'won' : 'lost';
      g.message = g.status === 'won'
        ? '任务完成：三次投递，合格菜品 ' + goods + ' 盘'
        : '任务失败：合格菜品仅 ' + goods + ' 盘，少于两盘';
      g.messageT = 99;
    }
    return true;
  }

  function step(g, input, dt) {
    dt = Math.min(dt, 0.05);
    g.t += dt;
    if (g.messageT > 0) g.messageT -= dt;
    if (g.shake > 0) g.shake = Math.max(0, g.shake - dt * 3);
    g.wind = windAt(g.t);
    if (g.status !== 'running') return g;

    const prevV = g.v;
    if (input.estop) {
      if (Math.abs(g.v) > 0.5) {
        if (!g.estopActive) {
          addSpill(g, 0.1 + Math.abs(g.v) * 0.0011);
          g.shake = 1;
        }
        g.v = moveToward(g.v, 0, ESTOP_RATE * dt);
        g.estopActive = true;
      } else {
        g.v = 0;
        g.estopActive = false;
      }
    } else {
      g.estopActive = false;
      g.v += clamp(input.throttle || 0, -1, 1) * ACCEL * dt;
      g.v = clamp(g.v, V_MIN, V_MAX);
    }

    const prevS = g.s;
    g.s = clamp(g.s + g.v * dt / CABLE_LEN, 0, 1);
    if (g.s === 0 || g.s === 1) g.v = 0;
    const apAlong = (g.v - prevV) / dt;
    g.apAlong = apAlong;
    const tan = cableTangent(g.s);
    const ap = { x: tan.x * apAlong, y: tan.y * apAlong };

    const torqueG = -(G / ROD_L) * Math.sin(g.theta);
    const torquePivot = -(ap.x * Math.cos(g.theta) - ap.y * Math.sin(g.theta)) / ROD_L;
    const torqueWind = (g.wind / ROD_L) * Math.cos(g.theta);
    g.omega += (torqueG + torquePivot + torqueWind - DAMP * g.omega) * dt;
    g.theta = clamp(g.theta + g.omega * dt, -1.45, 1.45);

    const absTilt = Math.abs(g.theta);
    if (absTilt > TILT_LIMIT) {
      addSpill(g, (absTilt - TILT_LIMIT) * 0.62 * dt);
    }
    if (Math.abs(apAlong) > JERK_LIMIT) {
      addSpill(g, (Math.abs(apAlong) - JERK_LIMIT) * 0.00042 * dt);
    }

    const coolFactor = coolingRate(g.wind);
    for (const d of activeDishes(g)) {
      d.temp -= coolFactor * (d.temp - TEMP_AMBIENT) * dt;
    }

    if (input.deliver) tryDeliver(g);
    return g;
  }

  /* 自动驾驶：温和加减速、避开急停、等摆动收敛后投递 */
  function autopilot(g) {
    const inp = { throttle: 0, estop: false, deliver: false };
    if (g.status !== 'running' || g.nextDeck >= DECKS.length) return inp;
    const deck = DECKS[g.nextDeck];
    const dist = (deck.s - g.s) * CABLE_LEN;
    const adist = Math.abs(dist);
    if (adist <= ZONE_PX && Math.abs(g.v) <= 15
      && Math.abs(g.theta) <= 0.11 && Math.abs(g.omega) <= 0.38) {
      inp.deliver = true;
      return inp;
    }
    if (Math.abs(g.theta) > 0.24) return inp;
    if (adist <= ZONE_PX + 6) {
      if (g.v > 16) inp.throttle = -1;
      else if (g.v < -8) inp.throttle = 1;
      return inp;
    }
    const brakeDist = (g.v * g.v) / (2 * ACCEL * 0.72) + 16;
    const dir = Math.sign(dist) || 1;
    if (adist <= brakeDist && Math.sign(g.v) === dir) inp.throttle = -dir;
    else inp.throttle = dir;
    if (inp.throttle === 1 && g.v > V_MAX * 0.85) inp.throttle = 0;
    return inp;
  }

  function coolingRate(wind) {
    return COOL_K * (1 + 0.3 * Math.abs(wind) / WIND_SCALE);
  }

  return {
    W, H, CABLE, ROD_L, CABLE_LEN, DECKS, ZONE_PX,
    TEMP_START, TEMP_MIN, TEMP_AMBIENT, WIND_SCALE,
    cablePoint, cableTangent, windAt, coolingRate,
    createGame, step, autopilot, tryDeliver, isEdible, inZone, isStable,
  };
});
