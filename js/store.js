/* 校准档案持久化：localStorage 保存设备档案与当前激活档案。 */
const Store = {
  KEY: 'audioLatencyCalib.v1',

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return this.empty();
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.profiles)) return this.empty();
      return {
        profiles: data.profiles,
        activeId: data.activeId || null,
        lastCompensationMs: Number(data.lastCompensationMs) || 0,
      };
    } catch (e) {
      return this.empty();
    }
  },

  empty() {
    return { profiles: [], activeId: null, lastCompensationMs: 0 };
  },

  save(state) {
    localStorage.setItem(this.KEY, JSON.stringify(state));
  },

  saveProfile(state, name, compensationMs, runs) {
    const now = new Date().toISOString();
    const existing = state.profiles.find((p) => p.name === name);
    const record = {
      id: existing ? existing.id : 'p_' + Date.now().toString(36),
      name,
      compensationMs,
      updatedAt: now,
      runs: runs.slice(),
    };
    if (existing) {
      Object.assign(existing, record);
    } else {
      state.profiles.push(record);
    }
    state.activeId = record.id;
    state.lastCompensationMs = compensationMs;
    this.save(state);
    return record;
  },

  deleteProfile(state, id) {
    state.profiles = state.profiles.filter((p) => p.id !== id);
    if (state.activeId === id) state.activeId = null;
    this.save(state);
  },

  activeProfile(state) {
    return state.profiles.find((p) => p.id === state.activeId) || null;
  },
};

window.Store = Store;
