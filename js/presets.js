import { DEFAULT_STATE } from "./acoustics.js";

const STORE_KEY = "virtual-studio-presets-v1";
const SESSION_KEY = "virtual-studio-session-v1";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式等场景下静默失败
  }
}

export function loadPresets() {
  const list = read(STORE_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function savePreset(name, state) {
  const list = loadPresets();
  list.push({
    id: `p${Date.now()}`,
    name,
    state: structuredClone(state),
    savedAt: new Date().toLocaleString("zh-CN"),
  });
  write(STORE_KEY, list);
  return list;
}

export function deletePreset(id) {
  write(STORE_KEY, loadPresets().filter((p) => p.id !== id));
  return loadPresets();
}

// 重开页面后恢复上次工作状态
export function saveSession(state) {
  write(SESSION_KEY, state);
}

export function loadSession() {
  const s = read(SESSION_KEY, null);
  if (!s || typeof s !== "object") return structuredClone(DEFAULT_STATE);
  const merged = { ...structuredClone(DEFAULT_STATE), ...s };
  merged.walls = { ...DEFAULT_STATE.walls, ...(s.walls || {}) };
  return merged;
}
