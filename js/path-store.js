// Listener path recording, localStorage persistence, and timed playback.

const STORAGE_KEY = 'hex-speaker-paths-v1';

export class PathStore {
  constructor() {
    this.recorded = [];
    this.recording = false;
    this.playback = null;
  }

  startRecording() {
    this.recordStart = performance.now();
    const first = this.lastPoint();
    this.recorded = [{ t: 0, x: first.x, y: first.y }];
    this.recording = true;
  }

  sample(listener) {
    if (!this.recording) return;
    const last = this.recorded[this.recorded.length - 1];
    const t = performance.now() - this.recordStart;
    if (!last || Math.hypot(listener.x - last.x, listener.y - last.y) > 0.01) {
      this.recorded.push({ t, x: listener.x, y: listener.y });
    }
  }

  stopRecording() {
    this.recording = false;
  }

  lastPoint() {
    return this.recorded.length
      ? this.recorded[this.recorded.length - 1]
      : { x: 0, y: 0 };
  }

  save(name) {
    const all = this.loadAll();
    all[name || `路径 ${new Date().toLocaleTimeString()}`] = {
      points: this.recorded,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  loadAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  delete(name) {
    const all = this.loadAll();
    delete all[name];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  }

  toJSON() {
    return JSON.stringify({ points: this.recorded,
      savedAt: new Date().toISOString() }, null, 2);
  }

  static fromJSON(text) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.points)) throw new Error('缺少 points 数组');
    return parsed.points;
  }

  // Calls onTick(point, progress) while interpolating, then onDone().
  play(points, onTick, onDone) {
    this.stopPlayback();
    if (!points || points.length < 2) {
      onDone();
      return;
    }
    const duration = points[points.length - 1].t;
    const start = performance.now();
    this.playback = { start, duration, points, onTick, onDone };
    const frame = (now) => {
      if (this.playback !== frame.token) return;
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      onTick(interpolate(points, elapsed), progress);
      if (progress >= 1) {
        this.playback = null;
        onDone();
      } else {
        requestAnimationFrame(frame);
      }
    };
    frame.token = this.playback;
    requestAnimationFrame(frame);
  }

  stopPlayback() {
    this.playback = null;
  }
}

function interpolate(points, elapsed) {
  if (elapsed <= points[0].t) return { x: points[0].x, y: points[0].y };
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (elapsed <= b.t) {
      const ratio = (elapsed - a.t) / (b.t - a.t || 1);
      return {
        x: a.x + (b.x - a.x) * ratio,
        y: a.y + (b.y - a.y) * ratio
      };
    }
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}
