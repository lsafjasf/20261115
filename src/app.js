import { buildAtlasDocument, validateAtlasDocument } from "./atlas-format.js";
import {
  canvasPngBlob,
  canvasPngRoundTrip,
  decodePngBlob,
  downloadBlob,
  drawPixelFrame,
  drawThumbnail,
  hashPixels,
  pixelsToCanvas,
} from "./browser-raster.js";
import {
  buildGeneratedFrames,
  makeGeneratedFrame,
  makeModifiedFrame,
  recolorFrame,
} from "./frame-factory.js";
import { IncrementalPacker } from "./packer.js";
import { composeAtlas } from "./raster.js";
import { runIncrementalSelfTest } from "./self-test.js";

const $ = (selector) => document.querySelector(selector);
const ATLAS_IMAGE_NAME = "incremental-atlas.png";
const ATLAS_JSON_NAME = "incremental-atlas.json";

const state = {
  packer: new IncrementalPacker({
    initialWidth: 256,
    initialHeight: 256,
    padding: 2,
    growthAlign: 16,
    maxSize: 2048,
  }),
  selectedId: null,
  lastOperationMs: 0,
  totalOperationMs: 0,
  lastAffected: null,
  activity: [],
  addSequence: 61,
  variant: 1,
  search: "",
  showTrims: true,
  showGrid: false,
  showHighlight: true,
  busy: false,
  builtinsLoaded: false,
};

const elements = {
  stats: {
    utilization: $("#stat-utilization"),
    area: $("#stat-area-detail"),
    size: $("#stat-size"),
    growth: $("#stat-growth"),
    repack: $("#stat-repack"),
    full: $("#stat-full"),
    lastMs: $("#stat-last-ms"),
    totalMs: $("#stat-total-ms"),
    frames: $("#stat-frames"),
    free: $("#stat-free"),
  },
  frameList: $("#frame-list"),
  frameCount: $("#frame-count"),
  frameSearch: $("#frame-search"),
  atlasCanvas: $("#atlas-canvas"),
  overlayCanvas: $("#overlay-canvas"),
  stageWrap: $("#stage-wrap"),
  stageChecker: $(".stage-checker"),
  emptyState: $("#empty-state"),
  stageSize: $("#stage-size-label"),
  stageSelection: $("#stage-selection-label"),
  selectionCard: $("#selection-card"),
  healthDot: $("#health-dot"),
  activityList: $("#activity-list"),
  verifyState: $("#verify-state"),
  verifyEmpty: $("#verify-empty"),
  verifyReport: $("#verify-report"),
  busy: $("#busy"),
  busyLabel: $("#busy-label"),
  toastStack: $("#toast-stack"),
};

function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

function setBusy(active, label = "正在处理…") {
  state.busy = active;
  elements.busyLabel.textContent = label;
  elements.busy.classList.toggle("hidden", !active);
}

function toast(message, kind = "ok") {
  const item = document.createElement("div");
  item.className = `toast ${kind === "fail" ? "fail" : ""}`;
  item.textContent = message;
  elements.toastStack.append(item);
  setTimeout(() => item.remove(), 3800);
}

function timestamp() {
  return new Date().toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function logActivity(label, ms, detail = "") {
  state.activity.unshift({
    label,
    ms,
    detail,
    time: timestamp(),
  });
  state.activity = state.activity.slice(0, 80);
  renderActivity();
}

function renderActivity() {
  elements.activityList.replaceChildren();
  if (!state.activity.length) {
    const empty = document.createElement("div");
    empty.className = "activity-empty";
    empty.textContent = "尚未执行增量操作。";
    elements.activityList.append(empty);
    return;
  }
  for (const entry of state.activity) {
    const row = document.createElement("div");
    row.className = "activity-row";
    const time = document.createElement("time");
    time.textContent = entry.time;
    const label = document.createElement("span");
    label.textContent = entry.detail
      ? `${entry.label} · ${entry.detail}`
      : entry.label;
    const timing = document.createElement("em");
    timing.textContent = formatMs(entry.ms);
    row.append(time, label, timing);
    elements.activityList.append(row);
  }
}

function updateStats() {
  const stats = state.packer.stats();
  elements.stats.utilization.textContent =
    `${(stats.utilization * 100).toFixed(2)}%`;
  elements.stats.area.textContent =
    `${stats.trimmedArea.toLocaleString()} / ${stats.area.toLocaleString()} px²`;
  elements.stats.size.textContent = `${stats.width} × ${stats.height}`;
  elements.stats.growth.textContent = `扩容 ${stats.growthCount} 次`;
  elements.stats.repack.textContent = stats.repackCount;
  elements.stats.full.textContent = stats.fullRepackCount;
  elements.stats.lastMs.textContent = formatMs(state.lastOperationMs);
  elements.stats.totalMs.textContent = formatMs(state.totalOperationMs);
  elements.stats.frames.textContent = stats.frameCount;
  elements.stats.free.textContent = stats.freeRectCount;
  elements.stageSize.textContent = `ATLAS ${stats.width} × ${stats.height}`;
  elements.frameCount.textContent = stats.frameCount;

  const errors = state.packer.validate();
  elements.healthDot.classList.toggle("fail", errors.length > 0);
  elements.healthDot.classList.toggle(
    "warn",
    errors.length === 0 && stats.frameCount === 0,
  );
  elements.healthDot.title = errors.length
    ? errors[0]
    : `布局有效 · 全量重排 ${stats.fullRepackCount} 次`;
}

function recordOperation(label, duration, detail = "") {
  state.lastOperationMs = duration;
  state.totalOperationMs += duration;
  logActivity(label, duration, detail);
  clearValidation();
  renderAll();
}

function clearValidation() {
  state.verifyResult = null;
  elements.verifyState.textContent = "WAITING";
  elements.verifyState.className = "";
  elements.verifyEmpty.classList.remove("hidden");
  elements.verifyReport.classList.add("hidden");
  elements.verifyReport.replaceChildren();
}

function renderFrameList() {
  const previousScroll = elements.frameList.scrollTop;
  elements.frameList.replaceChildren();
  const items = [...state.packer.items.values()];
  const query = state.search.trim().toLowerCase();
  const visible = query
    ? items.filter((item) =>
        `${item.name} ${item.id}`.toLowerCase().includes(query),
      )
    : items;

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "activity-empty";
    empty.textContent = items.length
      ? "没有匹配的帧。"
      : "队列为空。载入内置 PNG 或生成帧。";
    elements.frameList.append(empty);
    return;
  }

  for (const item of visible) {
    const row = document.createElement("button");
    row.className = "frame-row";
    row.dataset.id = item.id;
    row.classList.toggle("active", item.id === state.selectedId);
    row.type = "button";

    const thumb = document.createElement("canvas");
    thumb.className = "thumb";
    drawThumbnail(thumb, item.frame, 48);
    row.append(thumb);

    const info = document.createElement("div");
    info.className = "frame-info";
    const name = document.createElement("div");
    name.className = "frame-name";
    name.textContent = item.name;
    const meta = document.createElement("div");
    meta.className = "frame-meta";
    meta.textContent =
      `${item.sourceWidth}×${item.sourceHeight} · trim ${item.trim.w}×${item.trim.h}`;
    info.append(name, meta);
    if (item.rotated) {
      const badge = document.createElement("span");
      badge.className = "rotation-badge";
      badge.textContent = "90°";
      meta.append(badge);
    }
    row.append(info);

    const coords = document.createElement("div");
    coords.className = "frame-coords";
    coords.textContent = `${item.x},${item.y}`;
    row.append(coords);
    elements.frameList.append(row);
  }
  elements.frameList.scrollTop = previousScroll;
}

function selectFrame(id, redraw = true) {
  state.selectedId = id && state.packer.items.has(id) ? id : null;
  if (redraw) {
    renderFrameList();
    renderSelection();
    drawAtlas();
  }
}

function addProperty(grid, label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "property";
  const title = document.createElement("span");
  title.textContent = label;
  const output = document.createElement("strong");
  output.textContent = value;
  wrapper.append(title, output);
  grid.append(wrapper);
}

function renderSelection() {
  elements.selectionCard.replaceChildren();
  const item = state.selectedId
    ? state.packer.getFrame(state.selectedId)
    : null;
  if (!item) {
    const empty = document.createElement("div");
    empty.className = "empty-selection";
    const glyph = document.createElement("span");
    glyph.className = "selection-glyph";
    glyph.textContent = "＋";
    const text = document.createElement("p");
    text.textContent = "选择一帧查看切边、旋转与坐标。";
    empty.append(glyph, text);
    elements.selectionCard.append(empty);
    elements.stageSelection.textContent = "未选择帧";
    return;
  }

  const detail = document.createElement("div");
  detail.className = "selection-detail";
  const top = document.createElement("div");
  top.className = "selection-top";
  const thumb = document.createElement("canvas");
  thumb.className = "selection-thumb";
  drawThumbnail(thumb, item.frame, 72);
  top.append(thumb);

  const title = document.createElement("div");
  title.className = "selection-title";
  const strong = document.createElement("strong");
  strong.textContent = item.name;
  const subtitle = document.createElement("span");
  subtitle.textContent = item.id;
  const badges = document.createElement("div");
  badges.className = "badge-row";
  const trimmed = document.createElement("span");
  trimmed.className = "badge trimmed";
  trimmed.textContent = "TRIMMED";
  badges.append(trimmed);
  const rotated = document.createElement("span");
  rotated.className = `badge ${item.rotated ? "rotated" : ""}`;
  rotated.textContent = item.rotated ? "ROTATED 90° CW" : "UNROTATED";
  badges.append(rotated);
  title.append(strong, subtitle, badges);
  top.append(title);
  detail.append(top);

  const grid = document.createElement("div");
  grid.className = "property-grid";
  addProperty(grid, "ATLAS X / Y", `${item.x} / ${item.y}`);
  addProperty(grid, "ATLAS W / H", `${item.w} / ${item.h}`);
  addProperty(grid, "SOURCE", `${item.sourceWidth} × ${item.sourceHeight}`);
  addProperty(grid, "TRIM OFFSET", `${item.trim.x} / ${item.trim.y}`);
  addProperty(grid, "TRIM SIZE", `${item.trim.w} × ${item.trim.h}`);
  addProperty(
    grid,
    "RESERVED + PAD",
    `${item.reserved.w} × ${item.reserved.h}`,
  );
  detail.append(grid);
  elements.selectionCard.append(detail);
  elements.stageSelection.textContent =
    `${item.id} · ${item.w}×${item.h} @ ${item.x},${item.y}`;
}

function drawAtlas() {
  const stats = state.packer.stats();
  const hasFrames = stats.frameCount > 0;
  elements.emptyState.classList.toggle("hidden", hasFrames);
  elements.atlasCanvas.width = Math.max(1, stats.width);
  elements.atlasCanvas.height = Math.max(1, stats.height);
  elements.overlayCanvas.width = Math.max(1, stats.width);
  elements.overlayCanvas.height = Math.max(1, stats.height);

  if (!hasFrames) {
    elements.stageChecker.style.width = "256px";
    elements.stageChecker.style.height = "256px";
    elements.stageChecker.style.opacity = "0.35";
    return;
  }
  elements.stageChecker.style.opacity = "1";

  const atlas = composeAtlas(state.packer);
  const context = elements.atlasCanvas.getContext("2d");
  const image = context.createImageData(atlas.width, atlas.height);
  image.data.set(atlas.pixels);
  context.putImageData(image, 0, 0);

  const availableWidth = Math.max(160, elements.stageWrap.clientWidth - 88);
  const availableHeight = Math.max(120, elements.stageWrap.clientHeight - 82);
  const scale = Math.min(
    availableWidth / atlas.width,
    availableHeight / atlas.height,
  );
  elements.stageChecker.style.width = `${Math.max(1, atlas.width * scale)}px`;
  elements.stageChecker.style.height =
    `${Math.max(1, atlas.height * scale)}px`;

  const overlay = elements.overlayCanvas.getContext("2d");
  overlay.clearRect(0, 0, atlas.width, atlas.height);
  if (state.showGrid) {
    overlay.strokeStyle = "rgba(126, 219, 209, 0.16)";
    overlay.lineWidth = 1;
    for (let x = 16; x < atlas.width; x += 16) {
      overlay.beginPath();
      overlay.moveTo(x + 0.5, 0);
      overlay.lineTo(x + 0.5, atlas.height);
      overlay.stroke();
    }
    for (let y = 16; y < atlas.height; y += 16) {
      overlay.beginPath();
      overlay.moveTo(0, y + 0.5);
      overlay.lineTo(atlas.width, y + 0.5);
      overlay.stroke();
    }
  }
  if (state.showTrims) {
    for (const item of state.packer.items.values()) {
      overlay.strokeStyle =
        item.id === state.selectedId
          ? "rgba(201, 244, 95, 0.95)"
          : "rgba(255, 255, 255, 0.2)";
      overlay.lineWidth = item.id === state.selectedId ? 2 : 1;
      overlay.strokeRect(
        item.x + 0.5,
        item.y + 0.5,
        Math.max(1, item.w - 1),
        Math.max(1, item.h - 1),
      );
    }
  }
  if (state.showHighlight && state.lastAffected) {
    const rect = state.lastAffected;
    overlay.fillStyle = "rgba(255, 122, 89, 0.16)";
    overlay.fillRect(rect.x, rect.y, rect.w, rect.h);
    overlay.strokeStyle = "rgba(255, 122, 89, 0.9)";
    overlay.lineWidth = 2;
    overlay.strokeRect(
      rect.x + 1,
      rect.y + 1,
      Math.max(1, rect.w - 2),
      Math.max(1, rect.h - 2),
    );
  }
}

function renderAll() {
  updateStats();
  renderFrameList();
  renderSelection();
  drawAtlas();
}

function resetWorkspace({ clearActivity = false } = {}) {
  state.packer.clear();
  state.selectedId = null;
  state.lastAffected = null;
  state.lastOperationMs = 0;
  state.totalOperationMs = 0;
  state.addSequence = 61;
  state.variant = 1;
  state.builtinsLoaded = false;
  if (clearActivity) {
    state.activity = [];
    renderActivity();
  }
  clearValidation();
}

function uniqueFrameId(value, used) {
  const base =
    value
      .replace(/\.png$/i, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "frame";
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function loadBuiltins() {
  if (state.busy) return;
  setBusy(true, "正在载入内置 PNG…");
  const started = performance.now();
  try {
    resetWorkspace({ clearActivity: true });
    const response = await fetch("./assets/frames/manifest.json");
    if (!response.ok) throw new Error("Built-in manifest is unavailable.");
    const manifest = await response.json();
    const decoded = await Promise.all(
      manifest.frames.map(async (entry) => {
        const image = await fetch(`./assets/frames/${entry.file}`);
        if (!image.ok) throw new Error(`Cannot load ${entry.file}.`);
        const frame = await decodePngBlob(await image.blob());
        return {
          ...frame,
          id: entry.id,
          name: entry.name,
        };
      }),
    );
    for (const frame of decoded) state.packer.addFrame(frame);
    state.selectedId = decoded[0]?.id || null;
    state.builtinsLoaded = true;
    const duration = performance.now() - started;
    state.lastOperationMs = duration;
    state.totalOperationMs = duration;
    logActivity("载入内置 PNG", duration, `${decoded.length} 帧`);
    renderAll();
    toast(`已载入 ${decoded.length} 帧内置 PNG。`);
  } catch (error) {
    toast(`载入失败：${error.message}`, "fail");
  } finally {
    setBusy(false);
  }
}

function loadGenerated60() {
  resetWorkspace({ clearActivity: true });
  const started = performance.now();
  try {
    const frames = buildGeneratedFrames(60, { seed: 6101 });
    for (const frame of frames) state.packer.addFrame(frame);
    state.selectedId = frames[0]?.id || null;
    const duration = performance.now() - started;
    state.lastOperationMs = duration;
    state.totalOperationMs = duration;
    logActivity("生成 60 帧", duration, "初始增量打包");
    renderAll();
    toast("60 帧已生成，可继续增删或运行自检。");
  } catch (error) {
    toast(`生成失败：${error.message}`, "fail");
  }
}

async function loadPngFiles(files) {
  if (!files?.length || state.busy) return;
  setBusy(true, `正在解码 ${files.length} 个 PNG…`);
  resetWorkspace({ clearActivity: true });
  const started = performance.now();
  try {
    const decoded = await Promise.all(
      [...files].map(async (file) => ({
        ...(await decodePngBlob(file)),
        originalName: file.name,
      })),
    );
    const used = new Set();
    let count = 0;
    for (const frame of decoded) {
      const id = uniqueFrameId(frame.originalName, used);
      used.add(id);
      state.packer.addFrame({
        id,
        name: frame.originalName,
        width: frame.width,
        height: frame.height,
        pixels: frame.pixels,
      });
      count += 1;
    }
    state.selectedId = state.packer.items.keys().next().value || null;
    const duration = performance.now() - started;
    state.lastOperationMs = duration;
    state.totalOperationMs = duration;
    logActivity("导入 PNG", duration, `${count} 个文件`);
    renderAll();
    toast(`已导入 ${count} 个 PNG。`);
  } catch (error) {
    toast(`PNG 导入失败：${error.message}`, "fail");
  } finally {
    setBusy(false);
  }
}

function nextCustomFrame() {
  const used = new Set(state.packer.items.keys());
  let id = "";
  do {
    id = `custom-${String(state.addSequence).padStart(3, "0")}`;
    state.addSequence += 1;
  } while (used.has(id));
  return makeGeneratedFrame({
    id,
    name: `${id}.png`,
    seed: 7207 + state.addSequence * 47,
  });
}

function packerAction(label, action) {
  const started = performance.now();
  try {
    const result = action();
    const duration = performance.now() - started;
    state.lastAffected = result?.affected || null;
    recordOperation(label, duration, result?.detail || "");
    return result;
  } catch (error) {
    toast(`${label}失败：${error.message}`, "fail");
    return null;
  }
}

function addCustomFrame() {
  const frame = nextCustomFrame();
  const result = packerAction("新增帧", () =>
    state.packer.addFrame(frame),
  );
  if (result) {
    state.selectedId = frame.id;
    renderAll();
    toast(
      `新增 ${frame.id}${result.expanded ? " · 图集按需扩边" : ""}。`,
    );
  }
}

function deleteSelectedFrame() {
  const id = state.selectedId;
  if (!id) {
    toast("先选择一帧。", "fail");
    return;
  }
  const ids = [...state.packer.items.keys()];
  const index = ids.indexOf(id);
  const result = packerAction("删除帧", () => {
    const removed = state.packer.removeFrame(id);
    const remaining = [...state.packer.items.keys()];
    state.selectedId =
      remaining[Math.min(index, remaining.length - 1)] || null;
    return {
      ...removed,
      detail: `${id} 已释放空隙`,
    };
  });
  if (result) {
    renderAll();
    toast(`已删除 ${id}，仅释放该帧占用区域。`);
  }
}

function modifySelectedFrame() {
  const item = state.selectedId
    ? state.packer.getFrame(state.selectedId)
    : null;
  if (!item) {
    toast("先选择一帧。", "fail");
    return;
  }
  const frame = makeModifiedFrame(item.frame, state.variant);
  state.variant += 1;
  const id = item.id;
  const result = packerAction("修改尺寸", () =>
    state.packer.modifyFrame(frame),
  );
  if (result) {
    state.selectedId = id;
    renderAll();
    toast(
      result.repacked
        ? `${id} 尺寸变化，仅对该帧重新选位。`
        : `${id} 新尺寸仍可沿用原槽位，坐标未变。`,
    );
  }
}

function recolorSelectedFrame() {
  const item = state.selectedId
    ? state.packer.getFrame(state.selectedId)
    : null;
  if (!item) {
    toast("先选择一帧。", "fail");
    return;
  }
  const id = item.id;
  const result = packerAction("仅换色", () =>
    state.packer.modifyFrame(recolorFrame(item.frame)),
  );
  if (result) {
    state.selectedId = id;
    renderAll();
    toast(`${id} 像素已更新，未触发重新选位。`);
  }
}

function trackUtility(label, duration, detail = "") {
  state.lastOperationMs = duration;
  state.totalOperationMs += duration;
  logActivity(label, duration, detail);
  updateStats();
}

async function exportAtlasPng() {
  if (!state.packer.items.size) {
    toast("图集为空，无法导出。", "fail");
    return;
  }
  const started = performance.now();
  try {
    const atlas = composeAtlas(state.packer);
    const canvas = pixelsToCanvas(atlas.pixels, atlas.width, atlas.height);
    const blob = await canvasPngBlob(canvas);
    downloadBlob(blob, ATLAS_IMAGE_NAME);
    const duration = performance.now() - started;
    trackUtility("导出图集 PNG", duration, `${atlas.width}×${atlas.height}`);
    toast(`已导出 ${ATLAS_IMAGE_NAME}。`);
  } catch (error) {
    toast(`PNG 导出失败：${error.message}`, "fail");
  }
}

async function exportAtlasJson() {
  if (!state.packer.items.size) {
    toast("图集为空，无法导出。", "fail");
    return;
  }
  const started = performance.now();
  try {
    const documentData = await buildAtlasDocument(state.packer, {
      imageName: ATLAS_IMAGE_NAME,
      hashFrame: hashPixels,
      generatedAt: new Date().toISOString(),
    });
    const blob = new Blob([`${JSON.stringify(documentData, null, 2)}\n`], {
      type: "application/json",
    });
    downloadBlob(blob, ATLAS_JSON_NAME);
    const duration = performance.now() - started;
    trackUtility(
      "导出 JSON",
      duration,
      `${Object.keys(documentData.frames).length} 帧 · SHA-256`,
    );
    toast(`已导出 ${ATLAS_JSON_NAME}，含切边、旋转与原尺寸。`);
  } catch (error) {
    toast(`JSON 导出失败：${error.message}`, "fail");
  }
}

function renderVerifyReport({
  valid,
  framesChecked,
  errors,
  width,
  height,
  utilization,
  duration,
  slices = [],
  extra = [],
}) {
  state.verifyResult = { valid, framesChecked, errors };
  elements.verifyEmpty.classList.add("hidden");
  elements.verifyReport.classList.remove("hidden");
  elements.verifyReport.replaceChildren();
  elements.verifyState.textContent = valid ? "PASS" : "FAIL";
  elements.verifyState.className = valid ? "ok" : "fail";

  const banner = document.createElement("div");
  banner.className = `verify-banner ${valid ? "" : "fail"}`;
  const icon = document.createElement("span");
  icon.className = "verify-icon";
  icon.textContent = valid ? "✓" : "!";
  const bannerText = document.createElement("span");
  bannerText.textContent = valid
    ? "全部切片通过内容哈希校验"
    : `校验失败 · ${errors.length} 个问题`;
  banner.append(icon, bannerText);
  elements.verifyReport.append(banner);

  const stats = document.createElement("div");
  stats.className = "verify-stats";
  const values = [
    ["ATLAS", `${width} × ${height}`],
    ["FRAMES", String(framesChecked)],
    ["UTILIZATION", utilization == null
      ? "—"
      : `${(utilization * 100).toFixed(2)}%`],
    ["ELAPSED", formatMs(duration)],
  ];
  for (const [label, value] of values) {
    const cell = document.createElement("div");
    cell.className = "verify-stat";
    const heading = document.createElement("span");
    heading.textContent = label;
    const output = document.createElement("strong");
    output.textContent = value;
    cell.append(heading, output);
    stats.append(cell);
  }
  elements.verifyReport.append(stats);

  for (const line of extra) {
    const row = document.createElement("div");
    row.className = "verify-stat";
    row.style.marginBottom = "6px";
    const heading = document.createElement("span");
    heading.textContent = line.label;
    const output = document.createElement("strong");
    output.textContent = line.value;
    row.append(heading, output);
    elements.verifyReport.append(row);
  }

  if (errors.length) {
    const errorBox = document.createElement("pre");
    errorBox.className = "verify-errors";
    errorBox.textContent = errors.slice(0, 40).join("\n");
    elements.verifyReport.append(errorBox);
  }
  if (slices.length) {
    const strip = document.createElement("div");
    strip.className = "slice-strip";
    for (const slice of slices.slice(0, 18)) {
      const thumb = document.createElement("canvas");
      thumb.className = "slice-thumb";
      drawThumbnail(thumb, slice, 40);
      thumb.title = slice.id;
      strip.append(thumb);
    }
    elements.verifyReport.append(strip);
  }
}

async function verifyImportedFiles(files) {
  if (!files?.length || state.busy) return;
  const list = [...files];
  const jsonFile = list.find(
    (file) =>
      file.name.toLowerCase().endsWith(".json") ||
      file.type === "application/json",
  );
  const pngFiles = list.filter(
    (file) =>
      file.name.toLowerCase().endsWith(".png") ||
      file.type === "image/png",
  );
  if (!jsonFile || !pngFiles.length) {
    toast("请同时选择导出的 JSON 与图集 PNG。", "fail");
    return;
  }

  setBusy(true, "正在重新载入图集并校验切片…");
  const started = performance.now();
  try {
    const documentData = JSON.parse(await jsonFile.text());
    const png =
      pngFiles.find((file) => file.name === documentData.meta?.image) ||
      pngFiles[0];
    const atlas = await decodePngBlob(png);
    const result = await validateAtlasDocument({
      document: documentData,
      atlas: atlas.pixels,
      width: atlas.width,
      height: atlas.height,
      hashFrame: hashPixels,
    });
    const duration = performance.now() - started;
    renderVerifyReport({
      valid: result.valid,
      framesChecked: result.framesChecked,
      errors: result.errors,
      width: atlas.width,
      height: atlas.height,
      utilization: result.utilization,
      duration,
      slices: result.slices,
    });
    toast(
      result.valid
        ? `重载通过：${result.framesChecked} 个切片内容一致。`
        : `重载校验失败：${result.errors.length} 个问题。`,
      result.valid ? "ok" : "fail",
    );
  } catch (error) {
    const duration = performance.now() - started;
    renderVerifyReport({
      valid: false,
      framesChecked: 0,
      errors: [error.message],
      width: 0,
      height: 0,
      utilization: null,
      duration,
    });
    toast(`重载校验失败：${error.message}`, "fail");
  } finally {
    setBusy(false);
  }
}

async function runSelfTest() {
  if (state.busy) return;
  setBusy(true, "正在执行 60 帧增删与重载自检…");
  const started = performance.now();
  try {
    const result = await runIncrementalSelfTest({
      hashFrame: hashPixels,
      roundTripAtlas: canvasPngRoundTrip,
    });
    state.packer = result.packer;
    state.selectedId = state.packer.items.keys().next().value || null;
    state.lastAffected = null;
    state.lastOperationMs = result.report.timing.totalMs;
    state.totalOperationMs = result.report.timing.totalMs;
    state.addSequence = 61;
    state.variant = 1;
    clearValidation();
    logActivity(
      "60 帧自检",
      result.report.timing.totalMs,
      result.report.ok ? "PASS" : "FAIL",
    );
    renderAll();
    renderVerifyReport({
      valid: result.report.ok,
      framesChecked: result.report.reload.framesChecked,
      errors: result.report.reload.errors,
      width: result.report.finalDimensions.width,
      height: result.report.finalDimensions.height,
      utilization: result.report.utilization,
      duration: performance.now() - started,
      slices: result.reload.slices,
      extra: [
        {
          label: "ORIGINAL COORDS",
          value: result.report.coordinatesStable
            ? `STABLE · ${result.report.stableFrameCount} 帧`
            : `MOVED · ${result.report.changedIds.join(", ")}`,
        },
        {
          label: "OVERLAP CHECK",
          value: result.report.noOverlap ? "PASS · 0 overlap" : "FAIL",
        },
        {
          label: "ATLAS GROWTH",
          value: result.report.atlasDidNotDouble
            ? "BOUNDED · 无翻倍"
            : "UNEXPECTED DOUBLE",
        },
        {
          label: "REPACK / FULL",
          value:
            `${result.report.repackCount} / ${result.report.fullRepackCount}`,
        },
      ],
    });
    toast(
      result.report.ok
        ? "60 帧自检通过：坐标稳定、无重叠、重载切片一致。"
        : "60 帧自检未通过，请查看校验报告。",
      result.report.ok ? "ok" : "fail",
    );
  } catch (error) {
    toast(`自检执行失败：${error.message}`, "fail");
  } finally {
    setBusy(false);
  }
}

function selectFrameAt(event) {
  if (!state.packer.items.size) return;
  const bounds = elements.atlasCanvas.getBoundingClientRect();
  const x = Math.floor(
    ((event.clientX - bounds.left) / bounds.width) *
      elements.atlasCanvas.width,
  );
  const y = Math.floor(
    ((event.clientY - bounds.top) / bounds.height) *
      elements.atlasCanvas.height,
  );
  let hit = null;
  for (const item of state.packer.items.values()) {
    if (
      x >= item.x &&
      y >= item.y &&
      x < item.x + item.w &&
      y < item.y + item.h
    ) {
      hit = item.id;
    }
  }
  if (hit) selectFrame(hit);
}

function debounce(fn, delay) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function wireEvents() {
  $("#load-builtins").addEventListener("click", loadBuiltins);
  $("#load-test60").addEventListener("click", loadGenerated60);
  $("#run-selftest").addEventListener("click", runSelfTest);
  $("#add-frame").addEventListener("click", addCustomFrame);
  $("#delete-frame").addEventListener("click", deleteSelectedFrame);
  $("#modify-frame").addEventListener("click", modifySelectedFrame);
  $("#recolor-frame").addEventListener("click", recolorSelectedFrame);
  $("#export-png").addEventListener("click", exportAtlasPng);
  $("#export-json").addEventListener("click", exportAtlasJson);

  elements.frameSearch.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderFrameList();
  });
  elements.frameList.addEventListener("click", (event) => {
    const row = event.target.closest(".frame-row");
    if (row) selectFrame(row.dataset.id);
  });
  elements.atlasCanvas.addEventListener("click", selectFrameAt);

  $("#png-input").addEventListener("change", (event) => {
    loadPngFiles(event.target.files);
    event.target.value = "";
  });
  $("#validate-input").addEventListener("change", (event) => {
    verifyImportedFiles(event.target.files);
    event.target.value = "";
  });

  $("#toggle-trims").addEventListener("click", (event) => {
    state.showTrims = !state.showTrims;
    event.currentTarget.classList.toggle("active", state.showTrims);
    drawAtlas();
  });
  $("#toggle-grid").addEventListener("click", (event) => {
    state.showGrid = !state.showGrid;
    event.currentTarget.classList.toggle("active", state.showGrid);
    drawAtlas();
  });
  $("#toggle-highlight").addEventListener("click", (event) => {
    state.showHighlight = !state.showHighlight;
    event.currentTarget.classList.toggle("active", state.showHighlight);
    drawAtlas();
  });
  $("#clear-log").addEventListener("click", () => {
    state.activity = [];
    renderActivity();
  });
  window.addEventListener("resize", debounce(drawAtlas, 120));
}

function initialize() {
  wireEvents();
  renderActivity();
  renderAll();
  loadBuiltins();
}

initialize();
