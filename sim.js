// 纯物理仿真：不依赖 DOM / Canvas，可在 Node 中直接驱动做自动验证。
// 坐标：x 为横向位置（米，向右为正），z 为离地高度（米，向上为正）。

export const WORLD = {
  width: 1700,
  maxAlt: 260,
  dt: 0.05,
};

// 四个接收圈，地面高度不同，要求的投递高度窗口与速度上限也不同。
// altWindow: 投出时气球离地高度窗口；maxDropSpeed: 邮件触地时允许的最大垂直速度。
export const TARGETS = [
  { x: 330,  radius: 46, altWindow: [55, 100], maxGroundSpeed: 16, maxDropSpeed: 9 },
  { x: 700,  radius: 40, altWindow: [28, 55],  maxGroundSpeed: 13, maxDropSpeed: 8 },
  { x: 1080, radius: 44, altWindow: [95, 150], maxGroundSpeed: 15, maxDropSpeed: 10 },
  { x: 1460, radius: 36, altWindow: [145, 205],maxGroundSpeed: 12, maxDropSpeed: 8 },
];

export const CONFIG = {
  dryMass: 340,          // 气球本体 + 吊篮，kg
  bagMass: 20,           // 每袋邮件，kg
  bagCount: 4,
  maxLift: 470,          // 满热时最大升力等效质量，kg
  dragK: 6.0,            // 垂直气动阻力系数
  heatBurnRate: 0.16,    // 燃烧器每秒增加的热量（0..1）
  heatCoolRate: 0.03,    // 自然冷却每秒损失的热量
  ventRate: 0.12,        // 排气阀额外每秒损失的热量
  fuelDrain: 0.95,       // 燃烧器每秒燃料消耗（百分比）
  rudderAccel: 6.0,      // 风向舵相对空气的横向加速度，m/s²
  relaxTau: 3.5,         // 气球相对风速松弛时间常数，秒（体现横向惯性）
  startFuel: 100,
  startX: 70,
  startAlt: 125,
  crashSpeed: 11,        // 触地垂直速度超过此值即坠毁
  bagLifetime: 45,
};

// 起伏草原地形：多个正弦叠加，保证平缓且确定性。
export function terrainHeight(x) {
  const h =
    14 +
    7 * Math.sin(x / 165 + 0.7) +
    4.5 * Math.sin(x / 63 + 2.1) +
    2.5 * Math.sin(x / 27 + 4.0);
  return h;
}

// 随 x 与时间变化的风场（m/s，向右为正）。高度越高风越偏强。
export function windAt(x, z, t) {
  const base =
    3.2 +
    2.4 * Math.sin(x / 420 + 1.3) +
    1.1 * Math.sin(x / 130 - 0.5);
  const altitudeBias = 1.0 + Math.min(z, 220) / 320;
  const gust = 1.3 * Math.sin(t * 0.9 + x / 90) + 0.5 * Math.sin(t * 2.3);
  return base * altitudeBias + gust;
}

export class Simulation {
  constructor() {
    this.reset();
  }

  reset() {
    this.t = 0;
    this.x = CONFIG.startX;
    this.z = CONFIG.startAlt;
    this.vx = Math.min(8, windAt(this.x, this.z, 0)); // 初始温和地速
    this.vz = 0;
    this.heat = 0.9;
    this.fuel = CONFIG.startFuel;
    this.bagsLeft = CONFIG.bagCount;
    this.controls = { burn: false, vent: false, rudder: 0 }; // rudder: -1..1
    this.mail = [];        // 空中的邮件
    this.results = [];     // 每袋邮件的判定结果
    this.delivered = 0;
    this.status = "flying"; // flying | won | crashed | outoffuel
    this.lastEvent = null;
  }

  get mass() {
    return CONFIG.dryMass + this.bagsLeft * CONFIG.bagMass;
  }

  get groundZ() {
    return terrainHeight(this.x);
  }

  get altitude() {
    return this.z - this.groundZ;
  }

  get wind() {
    return windAt(this.x, this.z, this.t);
  }

  // 尝试投递，返回 { ok, reason }
  dropMail() {
    if (this.status !== "flying") return { ok: false, reason: "飞行已结束" };
    if (this.bagsLeft <= 0) return { ok: false, reason: "没有邮件了" };
    const alt = this.altitude;
    const speed = Math.hypot(this.vx, this.vz);
    const target = TARGETS[this.results.length];
    const [lo, hi] = target.altWindow;
    if (alt < lo || alt > hi) {
      return { ok: false, reason: `高度 ${alt.toFixed(0)}m 不在投递窗口 ${lo}-${hi}m 内` };
    }
    if (speed > target.maxGroundSpeed) {
      return { ok: false, reason: `速度 ${speed.toFixed(1)}m/s 超过上限 ${target.maxGroundSpeed}m/s` };
    }
    this.bagsLeft -= 1;
    const bag = {
      id: this.results.length,
      x: this.x,
      z: this.z - 6,
      vx: this.vx,
      vz: this.vz - 1.5, // 离篮轻微下抛
      age: 0,
      trail: [],
      resolved: false,
      dropAlt: alt,
    };
    this.mail.push(bag);
    this.lastEvent = { type: "drop", bagId: bag.id, t: this.t };
    // 立即占位登记，保证自动驾驶按接收圈顺序投递；落地时更新成败
    this.results.push({
      id: bag.id,
      success: false,
      pending: true,
      reason: "邮件在途",
      x: null,
      vz: null,
      t: this.t,
      altitudeAtDrop: alt,
    });
    return { ok: true, reason: `第 ${bag.id + 1} 袋邮件已投出` };
  }

  step(dt = WORLD.dt) {
    if (this.status !== "flying") return;
    this.t += dt;
    const c = this.controls;

    // —— 热量与燃料 ——
    if (c.burn && this.fuel > 0) {
      this.heat = Math.min(1, this.heat + CONFIG.heatBurnRate * dt);
      this.fuel = Math.max(0, this.fuel - CONFIG.fuelDrain * dt);
    } else {
      this.heat = Math.max(0.08, this.heat - CONFIG.heatCoolRate * dt);
    }
    if (c.vent) {
      this.heat = Math.max(0.05, this.heat - CONFIG.ventRate * dt);
    }

    // —— 垂直方向：升力 - 重力 - 气动阻力，强惯性 ——
    const lift = CONFIG.maxLift * this.heat;          // 等效质量
    const weight = this.mass;
    const drag = CONFIG.dragK * this.vz * Math.abs(this.vz);
    const az = ((lift - weight) * 9.81 - drag) / this.mass;
    this.vz += az * dt;
    this.z += this.vz * dt;
    if (this.z > WORLD.maxAlt) {
      this.z = WORLD.maxAlt;
      this.vz = Math.min(0, this.vz);
    }

    // —— 触地判定 ——
    const gz = terrainHeight(this.x);
    if (this.z <= gz + 1.5) {
      this.z = gz + 1.5;
      if (this.vz < -CONFIG.crashSpeed) {
        this.status = "crashed";
        this.lastEvent = { type: "crash", t: this.t, vz: this.vz };
        return;
      }
      this.vz = Math.max(0, this.vz);
    }

    // —— 横向：风向舵推力 + 向当地风速松弛（横向惯性） ——
    const wind = windAt(this.x, this.z, this.t);
    const rudder = c.rudder * CONFIG.rudderAccel;
    const ax = rudder + (wind - this.vx) / CONFIG.relaxTau;
    this.vx += ax * dt;
    this.x += this.vx * dt;
    this.x = Math.max(0, Math.min(WORLD.width, this.x));

    // —— 燃料耗尽且无在途邮件 ——
    if (this.fuel <= 0 && this.mail.length === 0 && this.delivered < TARGETS.length) {
      this.status = "outoffuel";
      this.lastEvent = { type: "outoffuel", t: this.t };
      return;
    }

    this._stepMail(dt);

    if (this.delivered >= TARGETS.length && this.fuel > 0) {
      this.status = "won";
      this.lastEvent = { type: "won", t: this.t };
    }
  }

  _stepMail(dt) {
    for (const bag of this.mail) {
      if (bag.resolved) continue;
      bag.age += dt;
      const wind = windAt(bag.x, bag.z, this.t);
      bag.vx += (wind - bag.vx) * Math.min(1, dt * 0.7); // 邮件受风
      // 邮件袋自带小型阻力伞：二次阻力，终端速度约 7-8 m/s
      const bagDrag = 0.17 * bag.vz * Math.abs(bag.vz);
      bag.vz += (-9.81 - bagDrag) * dt;
      bag.x += bag.vx * dt;
      bag.z += bag.vz * dt;
      if (bag.age % 0.25 < dt) bag.trail.push({ x: bag.x, z: bag.z });
      if (bag.trail.length > 160) bag.trail.shift();

      const ground = terrainHeight(bag.x);
      if (bag.z <= ground) {
        bag.z = ground;
        bag.resolved = true;
        this._resolveLanding(bag);
      } else if (bag.age > CONFIG.bagLifetime) {
        bag.resolved = true;
        this._record(bag, false, "邮件超时丢失");
      }
    }
    this.mail = this.mail.filter((b) => !b.resolved);
  }

  _resolveLanding(bag) {
    const target = TARGETS[bag.id];
    const dx = bag.x - target.x;
    const inCircle = Math.abs(dx) <= target.radius;
    const softEnough = Math.abs(bag.vz) <= target.maxDropSpeed;
    if (inCircle && softEnough) {
      this.delivered += 1;
      this._record(bag, true, `命中 ${target.x}m 接收圈，触地速度 ${Math.abs(bag.vz).toFixed(1)}m/s`);
    } else if (!inCircle) {
      this._record(bag, false, `落点偏离接收圈 ${Math.abs(dx).toFixed(0)}m（半径 ${target.radius}m）`);
    } else {
      this._record(bag, false, `触地速度 ${Math.abs(bag.vz).toFixed(1)}m/s 超过 ${target.maxDropSpeed}m/s`);
    }
  }

  _record(bag, success, reason) {
    const record = this.results.find((r) => r.id === bag.id && r.pending);
    if (record) {
      record.success = success;
      record.pending = false;
      record.reason = reason;
      record.x = bag.x;
      record.vz = bag.vz;
      record.t = this.t;
      record.altitudeAtDrop = bag.dropAlt;
    } else {
      this.results.push({
        id: bag.id, success, reason, x: bag.x, vz: bag.vz,
        t: this.t, altitudeAtDrop: bag.dropAlt,
      });
    }
    this.lastEvent = { type: success ? "delivered" : "missed", bagId: bag.id, t: this.t, reason };
  }
}

if (typeof process !== "undefined" && process.version) {
  // Node 测试入口
  globalThis.__balloonSim = { Simulation, CONFIG, TARGETS, WORLD, terrainHeight, windAt };
}
