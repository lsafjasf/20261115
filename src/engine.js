// Fault-injection testbed core engine (no DOM dependency; works in browser and Node).

export const FAULTS = ['missing', 'spike', 'delay', 'out_of_order'];

export const FAULT_LABEL = {
  missing: '缺失值',
  spike: '尖峰',
  delay: '延迟',
  out_of_order: '乱序时间戳',
};

export const SENSOR_META = [
  { id: 's1', name: '温度', unit: '°C', base: 42, amplitude: 6, periodMs: 12000, noise: 0.6, range: [0, 80], warn: [60, 70] },
  { id: 's2', name: '压力', unit: 'kPa', base: 210, amplitude: 18, periodMs: 17000, noise: 1.2, range: [120, 300], warn: [255, 275] },
  { id: 's3', name: '流量', unit: 'L/min', base: 75, amplitude: 12, periodMs: 21000, noise: 0.9, range: [30, 120], warn: [100, 110] },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Deterministic-ish synthetic signal: slow sine + small random noise, all code generated.
export function generateSample(meta, timestampMs) {
  const phase = (timestampMs % meta.periodMs) / meta.periodMs * Math.PI * 2;
  const wave = meta.amplitude * Math.sin(phase);
  const noise = (Math.random() * 2 - 1) * meta.noise;
  return clamp(meta.base + wave + noise, meta.range[0], meta.range[1]);
}

function classifyAlarm(meta, value) {
  if (!Number.isFinite(value)) return 'error';
  if (value < meta.range[0] || value > meta.range[1]) return 'error';
  if (value >= meta.warn[1]) return 'critical';
  if (value >= meta.warn[0]) return 'warning';
  return 'ok';
}

export class SensorTestbed {
  constructor(nowProvider = Date.now) {
    this.now = nowProvider;
    this.clock = nowProvider();
    this.intervalMs = 500;
    this.stepIndex = 0;
    this.paused = false;
    this.sensors = SENSOR_META.map((meta) => ({
      meta,
      faults: new Set(),
      latest: null,
      delayBuffer: [],
      lastTs: -Infinity,
      lastDeliveredTs: -Infinity,
      missingStreak: 0,
      maxMissingStreak: 0,
      spikeActive: false,
      delayActive: false,
      outOfOrderActive: false,
      alarm: 'ok',
      history: [],
      alarms: [],
      series: [],
    }));
    this.logs = [];
    this.sequence = 0;
  }

  _log(type, sensorId, detail) {
    this.sequence += 1;
    this.logs.push({ seq: this.sequence, wallMs: this.now(), simMs: this.clock, step: this.stepIndex, type, sensorId, detail });
  }

  setPaused(paused) {
    this.paused = paused;
    this._log(paused ? 'pause' : 'resume', 'system', { paused });
  }

  setFault(sensorId, fault, enabled) {
    const sensor = this._sensor(sensorId);
    if (!FAULTS.includes(fault)) throw new Error(`unknown fault: ${fault}`);
    if (enabled) {
      sensor.faults.add(fault);
      this._log('fault_on', sensorId, { fault });
    } else {
      sensor.faults.delete(fault);
      this._log('fault_off', sensorId, { fault });
      if (fault === 'delay') this._flushDelayBuffer(sensor, true);
    }
  }

  // One click: clear every injected fault on every sensor, then emit a clean sample.
  recoverAll() {
    const active = [];
    for (const sensor of this.sensors) {
      for (const fault of sensor.faults) active.push({ sensorId: sensor.meta.id, fault });
      sensor.faults.clear();
    }
    this._log('recover', 'system', { cleared: active });
    for (const sensor of this.sensors) this._flushDelayBuffer(sensor, true);
    this.tick(true);
    return active;
  }

  exportLogs() {
    const header = ['seq', 'wallMs', 'simMs', 'step', 'type', 'sensorId', 'fault', 'detail'];
    const rows = this.logs.map((entry) => [
      entry.seq, entry.wallMs, entry.simMs, entry.step, entry.type, entry.sensorId,
      entry.detail?.fault ?? '', JSON.stringify(entry.detail ?? {}),
    ]);
    return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
  }

  _sensor(id) {
    return this.sensors.find((item) => item.meta.id === id);
  }

  // Advance simulated time by one interval and process every sensor once.
  // force=true is used by single-step while paused and by one-click recovery.
  tick(force = false) {
    if (this.paused && !force) return [];
    this.clock += this.intervalMs;
    this.stepIndex += 1;
    const events = [];
    for (const sensor of this.sensors) events.push(...this._processSensor(sensor));
    this._log('tick', 'system', { step: this.stepIndex, eventCount: events.length });
    return events;
  }

  _processSensor(sensor) {
    const meta = sensor.meta;
    const events = [];
    const ts = this.clock;
    sensor.lastTs = ts;
    sensor.spikeActive = false;
    sensor.outOfOrderActive = false;

    if (sensor.faults.has('missing')) {
      sensor.missingStreak += 1;
      sensor.maxMissingStreak = Math.max(sensor.maxMissingStreak, sensor.missingStreak);
      const event = { kind: 'missing', sensorId: meta.id, ts, streak: sensor.missingStreak };
      events.push(event);
      this._log('missing', meta.id, { ts, streak: sensor.missingStreak });
      this._raiseAlarm(sensor, 'missing', `连续 ${sensor.missingStreak} 个采样缺失`);
    } else {
      sensor.missingStreak = 0;
    }

    if (sensor.faults.has('spike')) {
      const magnitude = meta.range[1] * (0.55 + Math.random() * 0.35);
      const sign = Math.random() < 0.5 ? -1 : 1;
      const spiked = clamp(generateSample(meta, ts) + sign * magnitude, meta.range[0] - 20, meta.range[1] + 20);
      sensor.spikeActive = true;
      this._log('spike', meta.id, { ts, value: round(spiked), magnitude: round(sign * magnitude) });
      this._deliver(sensor, spiked, ts, events, true);
    } else if (!sensor.faults.has('missing')) {
      this._deliver(sensor, generateSample(meta, ts), ts, events, false);
    }

    // Delay fault: hold a fresh sample back, release the oldest buffered one.
    if (sensor.faults.has('delay')) {
      sensor.delayActive = true;
      const held = events.filter((event) => event.kind === 'sample').pop();
      if (held) {
        sensor.delayBuffer.push(held);
        events.splice(events.indexOf(held), 1);
        this._log('delay_hold', meta.id, { ts: held.ts, buffered: sensor.delayBuffer.length });
      }
      if (sensor.delayBuffer.length > 1) {
        const released = sensor.delayBuffer.shift();
        events.push(released);
        this._log('delay_release', meta.id, { ts: released.ts, ageMs: this.clock - released.ts, buffered: sensor.delayBuffer.length });
      }
    } else {
      sensor.delayActive = false;
    }

    // Out-of-order fault: stamp the newest sample before the previous delivered timestamp.
    if (sensor.faults.has('out_of_order')) {
      const candidate = events.filter((event) => event.kind === 'sample').pop();
      if (candidate && Number.isFinite(sensor.lastDeliveredTs)) {
        const reorderedTs = sensor.lastDeliveredTs - this.intervalMs * (1 + Math.floor(Math.random() * 2));
        this._log('out_of_order', meta.id, { ts: reorderedTs, previousTs: sensor.lastDeliveredTs, skewMs: sensor.lastDeliveredTs - reorderedTs });
        candidate.ts = reorderedTs;
        candidate.outOfOrder = true;
        sensor.outOfOrderActive = true;
      }
    }

    for (const event of events) {
      if (event.kind === 'sample') this._commitSample(sensor, event);
    }
    return events;
  }

  _deliver(sensor, value, ts, events, isSpike) {
    events.push({ kind: 'sample', sensorId: sensor.meta.id, ts, value: round(value), isSpike });
  }

  _commitSample(sensor, event) {
    const meta = sensor.meta;
    sensor.latest = event;
    sensor.lastDeliveredTs = event.ts;
    sensor.history.push(event);
    if (sensor.history.length > 240) sensor.history.shift();
    sensor.series.push({ ts: event.ts, value: event.value, outOfOrder: Boolean(event.outOfOrder), isSpike: Boolean(event.isSpike) });
    if (sensor.series.length > 240) sensor.series.shift();
    const level = classifyAlarm(meta, event.value);
    if (level !== 'ok') {
      this._raiseAlarm(sensor, level, `${meta.name}读数 ${event.value}${meta.unit} 触发 ${level}`, event);
    } else {
      this._clearAlarm(sensor, 'value_ok');
    }
  }

  _raiseAlarm(sensor, level, message, event = null) {
    const previous = sensor.alarm;
    sensor.alarm = level;
    if (previous !== level || level === 'missing' || level === 'critical') {
      const record = { level, message, ts: this.clock, value: event?.value ?? null };
      sensor.alarms.unshift(record);
      sensor.alarms.length = Math.min(sensor.alarms.length, 50);
      this._log('alarm', sensor.meta.id, { level, message });
    }
  }

  _clearAlarm(sensor, reason) {
    if (sensor.alarm !== 'ok') this._log('alarm_clear', sensor.meta.id, { previous: sensor.alarm, reason });
    sensor.alarm = 'ok';
  }

  _flushDelayBuffer(sensor, reason) {
    while (sensor.delayBuffer.length) {
      const held = sensor.delayBuffer.shift();
      this._log('delay_release', sensor.meta.id, { ts: held.ts, ageMs: this.clock - held.ts, buffered: sensor.delayBuffer.length, recovery: reason === true });
      this._commitSample(sensor, held);
    }
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
