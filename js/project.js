export const STORAGE_KEY = "virtual-loom-project-v1";

export const DEFAULT_PADS = [
  {
    id: 0,
    drum: "kick",
    label: "大鼓",
    color: "#d4574e",
    key: "d",
  },
  {
    id: 1,
    drum: "snare",
    label: "军鼓",
    color: "#e8a33d",
    key: "f",
  },
  {
    id: 2,
    drum: "hat",
    label: "踩镲",
    color: "#5ca89c",
    key: "j",
  },
  {
    id: 3,
    drum: "tom",
    label: "通鼓",
    color: "#4a7fb5",
    key: "k",
  },
];

export const DEFAULT_SEQUENCE = [
  0, null, 2, null, 1, null, 2, 2,
  0, null, 2, null, 3, 1, 2, null,
];

export function createDefaultProject() {
  return {
    schemaVersion: 1,
    kind: "virtual-loom-project",
    title: "我的第一匹布",
    bpm: 100,
    sequence: [...DEFAULT_SEQUENCE],
    pads: DEFAULT_PADS.map((pad) => ({ ...pad })),
    savedAt: null,
    lastReport: null,
  };
}

function normalizedTitle(value) {
  const title = typeof value === "string" ? value.trim() : "";
  return title.slice(0, 30) || "未命名织片";
}

function normalizedBpm(value) {
  const bpm = Number(value);
  if (!Number.isFinite(bpm)) return 100;
  return Math.round(Math.max(40, Math.min(240, bpm)));
}

function normalizedPads(value) {
  const source = Array.isArray(value) ? value : [];
  return DEFAULT_PADS.map((fallback, index) => {
    const candidate = source.find((pad) => Number(pad?.id) === index) ?? source[index];
    const color =
      typeof candidate?.color === "string" &&
      /^#[0-9a-f]{6}$/i.test(candidate.color)
        ? candidate.color
        : fallback.color;
    return {
      ...fallback,
      color,
      label:
        typeof candidate?.label === "string" && candidate.label.trim()
          ? candidate.label.trim().slice(0, 8)
          : fallback.label,
    };
  });
}

function normalizedSequence(value) {
  if (!Array.isArray(value) || value.length !== 16) {
    throw new Error("序列必须包含 16 拍。");
  }
  return value.map((step) => {
    if (step === null || step === undefined || step === "") return null;
    const id = Number(step);
    if (!Number.isInteger(id) || id < 0 || id > 3) {
      throw new Error("每一拍必须是空拍或 0–3 号鼓。");
    }
    return id;
  });
}

export function normalizeProject(input, { allowMissingSequence = false } = {}) {
  if (!input || typeof input !== "object") {
    throw new Error("JSON 内容不是有效的织机作品。");
  }
  if (input.kind && input.kind !== "virtual-loom-project") {
    throw new Error("这不是虚拟织机作品文件。");
  }
  const sequence = allowMissingSequence
    ? normalizedSequence(input.sequence ?? DEFAULT_SEQUENCE)
    : normalizedSequence(input.sequence);
  return {
    schemaVersion: 1,
    kind: "virtual-loom-project",
    title: normalizedTitle(input.title),
    bpm: normalizedBpm(input.bpm),
    sequence,
    pads: normalizedPads(input.pads),
    savedAt: typeof input.savedAt === "string" ? input.savedAt : null,
    lastReport:
      input.lastReport && typeof input.lastReport === "object"
        ? input.lastReport
        : null,
  };
}

export function cloneResults(results) {
  if (!Array.isArray(results)) return new Array(16).fill(null);
  return Array.from({ length: 16 }, (_, index) => {
    const result = results[index];
    if (!result || typeof result !== "object") return null;
    const allowed = new Set(["hit", "miss", "error", "rest"]);
    if (!allowed.has(result.status)) return null;
    return {
      status: result.status,
      color:
        typeof result.color === "string" &&
        /^#[0-9a-f]{6}$/i.test(result.color)
          ? result.color
          : null,
      padId: Number.isInteger(result.padId) ? result.padId : null,
    };
  });
}

export function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const project = normalizeProject(parsed.project, {
      allowMissingSequence: true,
    });
    const run = parsed.run && typeof parsed.run === "object" ? parsed.run : {};
    const activeBeat = Number.isInteger(run.activeBeat)
      ? Math.max(-1, Math.min(15, run.activeBeat))
      : -1;
    const validStates = new Set(["idle", "playing", "paused", "finished"]);
    return {
      project,
      run: {
        state: validStates.has(run.state) ? run.state : "idle",
        activeBeat,
        remainingMs: Math.max(0, Number(run.remainingMs) || 0),
        results: cloneResults(run.results),
        mode: run.mode === "follow" ? "follow" : "auto",
      },
    };
  } catch {
    return null;
  }
}

export function persistState(project, run) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        project: {
          ...project,
          savedAt: project.savedAt,
        },
        run,
        persistedAt: new Date().toISOString(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function downloadProject(project, report) {
  const payload = {
    schemaVersion: 1,
    kind: "virtual-loom-project",
    title: project.title,
    bpm: project.bpm,
    sequence: [...project.sequence],
    pads: project.pads.map((pad) => ({ ...pad })),
    savedAt: new Date().toISOString(),
    lastReport: report,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeTitle = project.title.replace(/[\\/:*?"<>|]/g, "-");
  anchor.href = url;
  anchor.download = `${safeTitle || "virtual-loom"}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return payload;
}
