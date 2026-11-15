// 气象塔双人协作 —— 纯逻辑引擎（无 DOM / 无音频依赖，可在 Node 与浏览器中运行）

export const DEFAULT_CONFIG = {
  requiredReplacements: 3, // 需要完成的仪器更换组数
  linkHoldMs: 5 * 60 * 1000, // 通信链路需要累计保持的时长（五分钟）
  graceMs: 12000, // 链路中断宽限期：需大于单次仪器更换的断电时长
  alignWindowDeg: 10, // 摇臂与目标夹角小于该值视为对正
  rotationStepDeg: 4, // 单次旋转输入的步进角度
  windStepDeg: 3, // 每个风力 tick 摇臂被吹偏的最大角度
  windTickMs: 250, // 风力刷新间隔
  outageIntervalMs: 45000, // 主电源周期性中断间隔（避开仪器更换窗口）
  outageDurationMs: 3000, // 每次主电源中断持续时长
  batteryDrainPerSec: 18, // 电池供电时每秒耗电百分比
  batteryChargePerSec: 10, // 主电源供电时每秒回充百分比
  replaceMs: 6000, // 一组仪器更换所需时长
  alarmLogSize: 40
};

// 顶部玩家输入（A 左转 / D 右转 / W 推进锁定销 / S 拔出锁定销 / F 共享报警）
export const TOP_INPUTS = ['left', 'right', 'pinIn', 'pinOut', 'alarm'];
// 底部玩家输入（Q 主电源 / E 备用电池 / X 断开传感器供电 / Enter 共享报警）
export const BOTTOM_INPUTS = ['main', 'battery', 'off', 'alarm'];

const TOP_ALARM_MESSAGES = [
  '塔顶请求：请断开传感器供电，准备更换仪器',
  '塔顶请求：摇臂已锁定，可以恢复供电',
  '塔顶请求：风力过大，正在重新对正，请稍候'
];
const BOTTOM_ALARM_MESSAGES = [
  '塔底报告：主电源已接通',
  '塔底报告：已切换备用电池，链路仍在线',
  '塔底报告：传感器供电已断开，请抓紧更换'
];

export class TowerGame {
  constructor(config = {}, rng = Math.random) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.rng = rng;
    this.reset();
  }

  reset() {
    const c = this.cfg;
    this.time = 0;
    this.elapsed = 0;
    this.windLevel = 0.4 + this.rng() * 0.3; // 0..1
    this.windPhase = this.rng() * Math.PI * 2;
    this.armAngle = (this.rng() * 2 - 1) * 30;
    this.targetAngle = 0;
    this.pinEngaged = false;
    this.powerSource = 'main'; // main | battery | off
    this.mainOnline = true;
    this.outageUntil = 0;
    this.nextOutageAt = c.outageIntervalMs;
    this.battery = 100;
    this.replacement = 0; // 已完成组数
    this.replaceProgress = 0;
    this.replaceIdle = false;
    this.linkOnline = true;
    this.linkHoldAccum = 0;
    this.linkDownAccum = 0;
    this.status = 'running'; // running | won | lost
    this.lostReason = null;
    this.debugForceDown = false;
    this._windCarry = 0;
    this.topAlarmIndex = 0;
    this.bottomAlarmIndex = 0;
    this.alarms = [];
    this.events = [];
    this._emit('start', '任务开始：三组仪器更换 + 链路保持五分钟');
    return this.state();
  }

  _emit(type, message) {
    const event = { t: this.time, type, message };
    this.events.push(event);
    if (this.events.length > 60) this.events.shift();
    return event;
  }

  _pushAlarm(kind, message) {
    const alarm = { t: this.time, kind, message };
    this.alarms.push(alarm);
    while (this.alarms.length > this.cfg.alarmLogSize) this.alarms.shift();
    this._emit('alarm', `[${kind}] ${message}`);
  }

  get aligned() {
    return Math.abs(this._angleError()) <= this.cfg.alignWindowDeg;
  }

  // 摇臂相对目标的带符号夹角（-180..180）
  _angleError() {
    let error = ((this.armAngle - this.targetAngle + 540) % 360) - 180;
    return error;
  }

  get powered() {
    return this.powerSource !== 'off' && this._sourceAvailable(this.powerSource);
  }

  _sourceAvailable(source) {
    if (source === 'main') return this.mainOnline;
    if (source === 'battery') return this.battery > 0;
    return false;
  }

  // 双人输入在同一步内提交，保证“同时输入”是原子的、可测试的
  handleInput(input = {}) {
    if (this.status !== 'running') return this.state();
    if (input.top) this._handleTop(input.top);
    if (input.bottom) this._handleBottom(input.bottom);
    return this.state();
  }

  _handleTop(action) {
    if (!TOP_INPUTS.includes(action)) throw new Error(`未知顶部输入: ${action}`);
    const c = this.cfg;
    switch (action) {
      case 'left':
        if (!this.pinEngaged) this.armAngle -= c.rotationStepDeg;
        else this._pushAlarm('系统', '摇臂已被锁定销固定，无法旋转');
        break;
      case 'right':
        if (!this.pinEngaged) this.armAngle += c.rotationStepDeg;
        else this._pushAlarm('系统', '摇臂已被锁定销固定，无法旋转');
        break;
      case 'pinIn':
        if (this.pinEngaged) break;
        this.replaceIdle = false;
        if (this.aligned) {
          this.pinEngaged = true;
          this._pushAlarm('塔顶', '锁定销已插入，摇臂固定');
          this._emit('pin', '锁定销插入');
        } else {
          this._pushAlarm('塔顶', `对正不足（偏差 ${Math.abs(this._angleError()).toFixed(1)}°），锁定销被弹回`);
        }
        break;
      case 'pinOut':
        if (this.pinEngaged) {
          this.pinEngaged = false;
          this.replaceIdle = false;
          this._emit('pin', '锁定销拔出');
        }
        break;
      case 'alarm': {
        const message = TOP_ALARM_MESSAGES[this.topAlarmIndex % TOP_ALARM_MESSAGES.length];
        this.topAlarmIndex += 1;
        this._pushAlarm('塔顶', message);
        break;
      }
    }
  }

  _handleBottom(action) {
    if (!BOTTOM_INPUTS.includes(action)) throw new Error(`未知底部输入: ${action}`);
    switch (action) {
      case 'main':
        if (!this.mainOnline) {
          this._pushAlarm('塔底', '主电源当前离线，无法接通');
          break;
        }
        if (this.powerSource !== 'main') {
          this.powerSource = 'main';
          this.replaceIdle = false;
          if (this._sourceAvailable('main')) this.linkDownAccum = 0;
          this._pushAlarm('塔底', '已切换主电源');
        }
        break;
      case 'battery':
        if (this.battery <= 0) {
          this._pushAlarm('塔底', '备用电池耗尽，无法切换');
          break;
        }
        if (this.powerSource !== 'battery') {
          this.powerSource = 'battery';
          this.replaceIdle = false;
          this.linkDownAccum = 0;
          this._pushAlarm('塔底', '已切换备用电池');
        }
        break;
      case 'off':
        if (this.powerSource !== 'off') {
          this.powerSource = 'off';
          this._pushAlarm('塔底', '已断开传感器供电');
        }
        break;
      case 'alarm': {
        const message = BOTTOM_ALARM_MESSAGES[this.bottomAlarmIndex % BOTTOM_ALARM_MESSAGES.length];
        this.bottomAlarmIndex += 1;
        this._pushAlarm('塔底', message);
        break;
      }
    }
  }

  debugBreakLink() {
    if (this.status === 'running') {
      this.debugForceDown = true;
      this._pushAlarm('系统', '调试：强制切断通信链路');
      this.update(0);
    }
    return this.state();
  }

  debugRecoverLink() {
    this.debugForceDown = false;
    return this.update(0);
  }

  update(dtMs) {
    if (this.status !== 'running') return this.state();
    dtMs = Math.max(0, dtMs);
    this.time += dtMs;
    this.elapsed += dtMs;

    this._windCarry += dtMs;
    while (this._windCarry >= this.cfg.windTickMs) {
      this._windCarry -= this.cfg.windTickMs;
      this._windTick();
    }
    this._powerTick(dtMs);

    const wasOnline = this.linkOnline;
    const nowOnline = this.powered && !this.debugForceDown;
    this.linkOnline = nowOnline;
    if (nowOnline) {
      this.linkHoldAccum += dtMs;
      this.linkDownAccum = 0;
      if (!wasOnline) this._pushAlarm('系统', '通信链路已恢复');
    } else {
      this.linkDownAccum += dtMs;
      if (wasOnline) this._pushAlarm('系统', '通信链路中断：请在宽限期内恢复供电');
      if (this.linkDownAccum > this.cfg.graceMs) {
        this._lose('link', '通信链路中断超过宽限期，任务失败');
        return this.state();
      }
    }

    if (
      this.replacement >= this.cfg.requiredReplacements &&
      this.linkHoldAccum >= this.cfg.linkHoldMs
    ) {
      this.status = 'won';
      this._emit('win', '三组仪器更换完成，链路累计在线五分钟，任务成功');
    }
    return this.state();
  }

  _windTick() {
    const c = this.cfg;
    this.windLevel = Math.min(1, Math.max(0.05, this.windLevel + (this.rng() - 0.5) * 0.25));
    this.windPhase += 0.6 + this.rng() * 0.5;
    if (!this.pinEngaged) {
      const push = Math.sin(this.windPhase) * c.windStepDeg * this.windLevel;
      this.armAngle += push;
      if (this.armAngle > 90) this.armAngle = 90;
      if (this.armAngle < -90) this.armAngle = -90;
    }
  }

  _powerTick(tickMs) {
    const c = this.cfg;

    const canReplace = this.pinEngaged && !this.powered;
    if (!canReplace) {
      this.replaceProgress = 0;
      this.replaceIdle = false;
    }

    if (this.mainOnline && this.powerSource === 'main' && this.powered && this.time >= this.nextOutageAt) {
      this.mainOnline = false;
      this.outageUntil = this.time + c.outageDurationMs;
      this.nextOutageAt = this.time + c.outageIntervalMs;
      this._pushAlarm('系统', '主电源周期性中断！请切换备用电池');
    } else if (!this.mainOnline && this.time >= this.outageUntil) {
      this.mainOnline = true;
      this._pushAlarm('系统', '主电源恢复供电');
    }

    const seconds = tickMs / 1000;
    if (this.powerSource === 'battery' && this.battery > 0) {
      this.battery = Math.max(0, this.battery - c.batteryDrainPerSec * seconds);
      if (this.battery === 0) {
        this._pushAlarm('系统', '备用电池耗尽！');
      }
    } else if (this.powerSource === 'main' && this.mainOnline) {
      this.battery = Math.min(100, this.battery + c.batteryChargePerSec * seconds);
    }

    // 仪器更换要求：锁定销就位且传感器彻底断电
    if (canReplace) {
      if (this.replacement < c.requiredReplacements && !this.replaceIdle) {
        const before = this.replaceProgress;
        this.replaceProgress = Math.min(c.replaceMs, before + tickMs);
        if (before < c.replaceMs && this.replaceProgress >= c.replaceMs) {
          this.replacement += 1;
          this.replaceProgress = 0;
          this.replaceIdle = true;
          this._pushAlarm('系统', `第 ${this.replacement} 组仪器更换完成`);
        }
      }
    }
  }

  _lose(reason, message) {
    this.status = 'lost';
    this.lostReason = reason;
    this.linkOnline = false;
    this._pushAlarm('系统', message);
    this._emit('lose', message);
  }

  state() {
    return {
      time: this.time,
      elapsed: this.elapsed,
      windLevel: this.windLevel,
      armAngle: this.armAngle,
      targetAngle: this.targetAngle,
      angleError: this._angleError(),
      aligned: this.aligned,
      pinEngaged: this.pinEngaged,
      powerSource: this.powerSource,
      mainOnline: this.mainOnline,
      powered: this.powered,
      battery: this.battery,
      replacement: this.replacement,
      requiredReplacements: this.cfg.requiredReplacements,
      replaceProgress: this.replaceProgress,
      replaceMs: this.cfg.replaceMs,
      linkOnline: this.linkOnline,
      linkHoldAccum: this.linkHoldAccum,
      linkHoldTarget: this.cfg.linkHoldMs,
      linkDownAccum: this.linkDownAccum,
      graceMs: this.cfg.graceMs,
      status: this.status,
      lostReason: this.lostReason,
      alarms: this.alarms.slice()
    };
  }

  // 塔顶玩家视角：看得到摇臂/锁定销/风力，看不到电源细节
  topView() {
    const s = this.state();
    return {
      role: 'top',
      time: s.time,
      windLevel: s.windLevel,
      armAngle: s.armAngle,
      targetAngle: s.targetAngle,
      angleError: s.angleError,
      aligned: s.aligned,
      pinEngaged: s.pinEngaged,
      powered: s.powered,
      replacement: s.replacement,
      requiredReplacements: s.requiredReplacements,
      replaceProgress: s.replaceProgress,
      replaceMs: s.replaceMs,
      linkOnline: s.linkOnline,
      linkHoldAccum: s.linkHoldAccum,
      linkHoldTarget: s.linkHoldTarget,
      status: s.status,
      lostReason: s.lostReason,
      alarms: s.alarms
    };
  }

  // 塔底玩家视角：看得到供电/电池/链路，看不到摇臂角度与锁定销
  bottomView() {
    const s = this.state();
    return {
      role: 'bottom',
      time: s.time,
      powerSource: s.powerSource,
      mainOnline: s.mainOnline,
      powered: s.powered,
      battery: s.battery,
      replacement: s.replacement,
      requiredReplacements: s.requiredReplacements,
      linkOnline: s.linkOnline,
      linkHoldAccum: s.linkHoldAccum,
      linkHoldTarget: s.linkHoldTarget,
      linkDownAccum: s.linkDownAccum,
      graceMs: s.graceMs,
      status: s.status,
      lostReason: s.lostReason,
      alarms: s.alarms
    };
  }

  // 测试辅助：按固定步长推进时间
  runFor(durationMs, stepMs = 100) {
    let remaining = durationMs;
    while (remaining > 0 && this.status === 'running') {
      const step = Math.min(stepMs, remaining);
      this.update(step);
      remaining -= step;
    }
    return this.state();
  }
}

export function formatMs(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
