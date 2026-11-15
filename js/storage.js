import { STORAGE_KEY } from "./constants.js";

// 快照式保存：显式“保存”写入，可随时“恢复”，脏标记区分未保存改动。
export class SongStore {
  constructor(backend) {
    this.backend = backend ?? globalThis.localStorage ?? null;
  }

  save(snapshot) {
    if (!this.backend) return false;
    this.backend.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), snapshot }));
    return true;
  }

  load() {
    if (!this.backend) return null;
    const raw = this.backend.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  clear() {
    if (this.backend) this.backend.removeItem(STORAGE_KEY);
  }
}
