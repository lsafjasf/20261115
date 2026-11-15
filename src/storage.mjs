const STORAGE_KEY = 'lowpoly-city-scene-v1';

export function serializeScene(model, clipSnapshot) {
  return JSON.stringify({
    type: 'lowpoly-city',
    savedAt: new Date().toISOString(),
    model,
    clipping: clipSnapshot,
  }, null, 2);
}

export function parseScene(text) {
  const data = JSON.parse(text);
  if (!data || data.type !== 'lowpoly-city' || !data.model || !Array.isArray(data.model.buildings)) {
    throw new Error('文件不是有效的低多边形城区存档');
  }
  return data;
}

export function saveToLocal(model, clipSnapshot) {
  const text = serializeScene(model, clipSnapshot);
  localStorage.setItem(STORAGE_KEY, text);
  return text.length;
}

export function loadFromLocal() {
  const text = localStorage.getItem(STORAGE_KEY);
  return text ? parseScene(text) : null;
}

export function hasLocalSave() {
  return Boolean(localStorage.getItem(STORAGE_KEY));
}

export function clearLocal() {
  localStorage.removeItem(STORAGE_KEY);
}

export function downloadScene(model, clipSnapshot) {
  const blob = new Blob([serializeScene(model, clipSnapshot)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `city-${model.seed}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function uploadScene(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseScene(String(reader.result)));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
