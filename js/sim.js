import { Rng } from './rng.js';
import { buildLayout, T, DIR } from './layout.js';
import { recomputeField, moveAgents } from './pathing.js';

export const TICK_S = 0.1;            // 每步 0.1 秒
export const MAX_TICKS = 1200;        // 两分钟
export const TOTAL_PASSENGERS = 90;
export const HEAVY_SMOKE = 3.0;       // 浓烟不可通行
export const RISK_OCC = 8;            // 单元格 8 人触发踩踏风险
export const STAMPEDE_TICKS = 30;     // 持续 3 秒风险升级为踩踏

export class Sim {
  constructor(seed = 20261115) {
    this.layout = buildLayout();
    this.rng = new Rng(seed);
    this.tick = 0;
    this.time = 0;

    const { rows, cols } = this.layout;
    this.smoke = Array.from({ length: rows }, () => new Float32Array(cols));
    this.agents = [];
    this.nextAgentId = 1;
    this.spawned = 0;
    this.evacuated = 0;
    this.injuries = 0;
    this.safeBreached = false;
    this.over = false;
    this.result = null;
    this.events = [];

    this.occupancy = Array.from({ length: rows }, () => new Int16Array(cols));
    this.riskStreak = Array.from({ length: rows }, () => new Int16Array(cols));
    this.field = Array.from({ length: rows }, () => new Float32Array(cols).fill(Infinity));

    // 拥堵度量：累计拥挤人秒、峰值占用、各通道/闸门累计排队
    this.metrics = {
      congestionSeconds: 0,
      maxOccupancy: 0,
      riskTicks: 0,
      controlLoad: {},          // id -> 累计占用
      samples: [],              // 每 5 秒采样
    };
    [...this.layout.gates, ...this.layout.channels].forEach(
      (c) => { this.metrics.controlLoad[c.id] = 0; }
    );

    this._spawnCooldown = 0;
    this._sampleCooldown = 0;
    this._lastAlarmState = false;
    recomputeField(this);
  }

  controlAt(row, col) {
    return [...this.layout.gates, ...this.layout.channels]
      .find((c) => c.row === row && c.col === col) || null;
  }

  cycleControl(id) {
    const c = this.controlById(id);
    if (!c) return;
    const order = [DIR.OPEN, DIR.UP, DIR.CLOSED];
    c.dir = order[(order.indexOf(c.dir) + 1) % order.length];
    if (c.kind === 'gate') c.smokeShut = false;
    this.log(`通道 ${id} 调整为「${dirLabel(c.dir)}」`);
    recomputeField(this);
  }

  setDirection(id, dir) {
    const c = this.controlById(id);
    if (!c) return;
    c.dir = dir;
    recomputeField(this);
  }

  controlById(id) {
    return [...this.layout.gates, ...this.layout.channels].find((c) => c.id === id);
  }

  toggleFan(id) {
    const fan = this.layout.fans.find((f) => f.id === id);
    if (!fan) return;
    fan.on = !fan.on;
    this.log(`排烟机 ${id} ${fan.on ? '开启' : '关闭'}`);
  }

  log(text) {
    this.events.push({ tick: this.tick, time: this.time, text });
    if (this.events.length > 60) this.events.shift();
  }

  step() {
    if (this.over) return;
    this.tick += 1;
    this.time = +(this.tick * TICK_S).toFixed(2);

    this.spawnPassengers();
    this.updateSmoke();
    this.updateSensors();
    moveAgents(this);
    recomputeField(this);   // 每拍基于最新烟雾/占用/闸门重算，供下一拍寻路
    this.measure();
    this.evaluate();
  }

  run(maxTicks = MAX_TICKS) {
    while (!this.over && this.tick < maxTicks) this.step();
    return this.result;
  }

  // ---- 乘客生成 -------------------------------------------------------
  spawnPassengers() {
    if (this.spawned >= TOTAL_PASSENGERS) return;
    if (--this._spawnCooldown > 0) return;
    const spots = this.layout.spawns
      .filter((s) => this.smoke[s.row][s.col] < 1.2 && this.occupancy[s.row][s.col] < 3);
    if (!spots.length) { this._spawnCooldown = 2; return; }
    const spot = spots[this.rng.int(0, spots.length - 1)];
    this.agents.push({
      id: this.nextAgentId++,
      row: spot.row, col: spot.col,
      x: spot.col + 0.5, y: spot.row + 0.5,
      target: null, speed: 1.25,           // 格/秒
      evacTick: null,
    });
    this.spawned += 1;
    this._spawnCooldown = this.rng.int(3, 6);
  }

  // ---- 烟雾扩散 -------------------------------------------------------
  updateSmoke() {
    const { rows, cols, cells } = this.layout;
    const src = this.layout.smokeSource;
    const cur = this.smoke;
    const next = Array.from({ length: rows }, () => new Float32Array(cols));
    const k = 0.16; // 扩散系数

    // 墙体与边界始终无烟雾，确保缓冲中不存在 undefined / NaN
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cells[r][c] === T.WALL) next[r][c] = 0;
      }
    }

    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (cells[r][c] === T.WALL) continue;
        let level = cur[r][c];
        let delta = 0;
        const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
        for (const [nr, nc] of neighbors) {
          if (cells[nr][nc] === T.WALL) continue;
          let flow = k * (cur[nr][nc] - level);
          const gate = this.controlAt(nr, nc) || this.controlAt(r, c);
          if (gate && gate.dir === DIR.CLOSED) flow *= 0.3; // 关闭闸门隔烟
          delta += flow;
        }
        next[r][c] = (level + delta) * 0.985; // 自然沉降
      }
    }

    // 火源持续发烟；排烟机强抽排
    next[src.row][src.col] = Math.min(4, next[src.row][src.col] + src.emit);
    for (const fan of this.layout.fans) {
      if (!fan.on) continue;
      for (let r = fan.row - 3; r <= fan.row + 3; r++) {
        for (let c = fan.col - 3; c <= fan.col + 3; c++) {
          if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
          const dist = Math.hypot(r - fan.row, c - fan.col);
          if (dist <= 3) next[r][c] *= 1 - 0.22 * (1 - dist / 3.5);
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.smoke[r][c] = Math.max(0, Math.min(4, next[r][c]));
      }
    }
  }

  updateSensors() {
    let anyAlarm = false;
    for (const s of this.layout.sensors) {
      s.level = +this.smoke[s.row][s.col].toFixed(2);
      if (!s.alarm && s.level >= 0.6) {
        s.alarm = true;
        this.log(`烟感 ${s.id} 报警（浓度 ${s.level}）`);
      }
      if (s.alarm) anyAlarm = true;
    }
    if (anyAlarm && !this._lastAlarmState) this.log('警报启动：请按指示疏散');
    this._lastAlarmState = anyAlarm;
  }

  // ---- 度量与胜负 -----------------------------------------------------
  measure() {
    const { rows, cols, safeZone } = this.layout;
    for (let r = 0; r < rows; r++) this.occupancy[r].fill(0);
    for (const a of this.agents) this.occupancy[a.row][a.col] += 1;

    let tickCrowd = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const occ = this.occupancy[r][c];
        if (occ > this.metrics.maxOccupancy) this.metrics.maxOccupancy = occ;
        if (occ > 6) tickCrowd += occ - 6;
        if (occ >= RISK_OCC) {
          this.riskStreak[r][c] += 1;
          this.metrics.riskTicks += 1;
          if (this.riskStreak[r][c] === STAMPEDE_TICKS) {
            this.injuries += 3;
            this.log(`单元格 (${r},${c}) 持续拥堵，发生踩踏，3 人受伤`);
          }
        } else {
          this.riskStreak[r][c] = 0;
        }
      }
    }
    this.metrics.congestionSeconds += tickCrowd * TICK_S;

    for (const ctl of [...this.layout.gates, ...this.layout.channels]) {
      this.metrics.controlLoad[ctl.id] += this.occupancy[ctl.row][ctl.col];
    }

    if (--this._sampleCooldown <= 0) {
      this._sampleCooldown = 50;
      this.metrics.samples.push({
        t: this.time,
        evacuated: this.evacuated,
        aboard: this.agents.length,
        maxOcc: this.metrics.maxOccupancy,
        riskTicks: this.metrics.riskTicks,
      });
    }

    for (const s of safeZone) {
      if (this.smoke[s.row][s.col] > 0.6) {
        this.safeBreached = true;
        break;
      }
    }
  }

  evaluate() {
    if (this.injuries > 0) return this.finish(false, '发生踩踏事故，疏散失败');
    if (this.safeBreached) return this.finish(false, '烟雾侵入安全区，疏散失败');
    if (this.evacuated >= TOTAL_PASSENGERS) {
      return this.finish(true, `全部 ${TOTAL_PASSENGERS} 名乘客在 ${this.time}s 内安全疏散`);
    }
    if (this.tick >= MAX_TICKS) return this.finish(false, '两分钟超时，仍有乘客未疏散');
  }

  finish(win, reason) {
    this.over = true;
    this.result = {
      win, reason, time: this.time,
      evacuated: this.evacuated,
      total: TOTAL_PASSENGERS,
      injuries: this.injuries,
      safeBreached: this.safeBreached,
      maxOccupancy: this.metrics.maxOccupancy,
      congestionSeconds: +this.metrics.congestionSeconds.toFixed(2),
      riskTicks: this.metrics.riskTicks,
    };
    this.log(reason);
  }
}

export function dirLabel(dir) {
  return { open: '双向通行', up: '单向(向上)', down: '单向(向下)', closed: '关闭' }[dir] || dir;
}
