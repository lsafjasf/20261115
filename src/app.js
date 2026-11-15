import {
  createCircle,
  createPath,
  createRect,
  createScene,
  createStarterScene,
  createText,
  duplicateObject,
  generateRandomScene,
  sceneFromJSON,
  sceneToJSON,
  withZOrder
} from "./scene.js";
import {
  drawObject,
  drawScene,
  fontString,
  hitTest,
  textMetrics
} from "./canvas-renderer.js";
import { objectBounds } from "./geometry.js";
import { sceneToSVG } from "./svg-renderer.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const canvas = $("#canvas");
const ctx = canvas.getContext("2d");
const canvasMat = $(".canvas-mat");

const state = {
  scene: createStarterScene(),
  selectedId: null,
  tool: "select",
  draft: null,
  pathDraft: null,
  move: null,
  zoom: 1,
  suppressClick: false
};

const hints = {
  select: "Click an object to inspect it. Drag to move the selection.",
  rect: "Drag on the canvas to draw a rectangle.",
  circle: "Drag on the canvas to draw a circle.",
  path: "Click to add points. Double-click or press Enter to finish.",
  text: "Click anywhere to place editable text."
};

let toastTimer = null;

function selectedObject() {
  return state.scene.objects.find((object) => object.id === state.selectedId) || null;
}

function setTool(tool) {
  if (!["select", "rect", "circle", "path", "text"].includes(tool)) return;
  if (state.tool === "path" && tool !== "path") finishPath(false);
  state.tool = tool;
  state.draft = null;
  $(".canvas-mat").dataset.tool = tool;
  canvas.dataset.tool = tool;
  $$(".tool-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === tool);
  });
  $("#canvas-mode").textContent = tool[0].toUpperCase() + tool.slice(1);
  $("#stage-hint").textContent = hints[tool];
  renderCanvas();
}

function selectObject(id) {
  state.selectedId = id;
  renderCanvas();
  renderLayers();
  renderInspector();
  updateStatus();
}

function setScene(scene, options = {}) {
  state.scene = createScene(scene.objects, {
    width: scene.canvas.width,
    height: scene.canvas.height,
    background: scene.canvas.background
  });
  state.selectedId =
    options.selectId && state.scene.objects.some((object) => object.id === options.selectId)
      ? options.selectId
      : null;
  state.draft = null;
  state.pathDraft = null;
  hideTextEntry();
  renderAll();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  renderCanvas();
}

function sceneContext() {
  ctx.setTransform(
    canvas.width / state.scene.canvas.width,
    0,
    0,
    canvas.height / state.scene.canvas.height,
    0,
    0
  );
  return ctx;
}

function renderCanvas() {
  const context = sceneContext();
  drawScene(context, state.scene, { selectedId: state.selectedId });
  if (state.draft) {
    drawObject(context, state.draft, { opacity: 0.5 });
  }
  if (state.pathDraft?.points.length) {
    const preview = createPath({
      ...state.pathDraft,
      id: "path-preview",
      name: "Path preview",
      fill: null,
      stroke: { color: "#5b5bd6", width: 2.5 },
      opacity: 0.85
    });
    drawObject(context, preview);
    context.save();
    context.fillStyle = "#5b5bd6";
    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    state.pathDraft.points.forEach((point) => {
      context.beginPath();
      context.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });
    context.restore();
    if (state.pathDraft.hover) {
      const last = state.pathDraft.points[state.pathDraft.points.length - 1];
      context.save();
      context.strokeStyle = "#5b5bd6";
      context.lineWidth = 1.5;
      context.setLineDash([5, 4]);
      context.beginPath();
      context.moveTo(last.x, last.y);
      context.lineTo(state.pathDraft.hover.x, state.pathDraft.hover.y);
      context.stroke();
      context.restore();
    }
  }
}

function layerTypeLabel(object) {
  return { rect: "Rectangle", circle: "Ellipse", path: "Vector path", text: "Live text" }[
    object.type
  ];
}

function renderLayerThumbnail(element, object) {
  const thumbnail = element.querySelector("canvas");
  const context = thumbnail.getContext("2d");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, thumbnail.width, thumbnail.height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, thumbnail.width, thumbnail.height);
  const metrics = object.type === "text" ? textMetrics(context, object) : null;
  const bounds = metrics?.bounds || objectBounds(object);
  const padding = 5;
  const scale = Math.min(
    (thumbnail.width - padding * 2) / Math.max(1, bounds.width),
    (thumbnail.height - padding * 2) / Math.max(1, bounds.height),
    1.2
  );
  context.save();
  context.translate(thumbnail.width / 2, thumbnail.height / 2);
  context.scale(scale, scale);
  context.translate(-(bounds.x + bounds.width / 2), -(bounds.y + bounds.height / 2));
  drawObject(context, object);
  context.restore();
}

function renderLayers() {
  const list = $("#layer-list");
  $("#layer-count").textContent = String(state.scene.objects.length);
  if (!state.scene.objects.length) {
    list.innerHTML = `
      <div class="layer-empty">
        <span class="layer-empty-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5"/></svg>
        </span>
        <strong>Your canvas is empty</strong>
        <p>Pick a tool above or generate a test composition.</p>
      </div>`;
    return;
  }

  list.innerHTML = "";
  state.scene.objects
    .slice()
    .reverse()
    .forEach((object) => {
      const button = document.createElement("button");
      button.className = `layer-item${object.id === state.selectedId ? " is-selected" : ""}`;
      button.dataset.id = object.id;
      button.innerHTML = `
        <span class="layer-thumb"><canvas width="58" height="58"></canvas></span>
        <span class="layer-copy">
          <strong>${escapeHtml(object.name)}</strong>
          <small>${layerTypeLabel(object)}</small>
        </span>
        <span class="layer-order">${String(object.z + 1).padStart(2, "0")}</span>`;
      button.addEventListener("click", () => selectObject(object.id));
      button.addEventListener("dblclick", () => {
        if (object.type === "text") openTextEntry(object);
      });
      list.append(button);
      renderLayerThumbnail(button, object);
    });
}

function updateStatus() {
  const count = state.scene.objects.length;
  $("#object-summary").textContent = `${count} object${count === 1 ? "" : "s"}`;
  const selected = selectedObject();
  $("#selection-status").textContent = selected
    ? `${selected.name} selected · layer ${selected.z + 1}`
    : "No selection";
  $("#inspector-title").textContent = selected ? selected.name : "Document";
  $("#delete-object").classList.toggle("is-hidden", !selected);
}

function renderAll() {
  renderCanvas();
  renderLayers();
  renderInspector();
  updateStatus();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function numberField(label, field, value, options = {}) {
  return `
    <label class="field${options.wide ? " field-wide" : ""}">
      <span>${label}</span>
      <input type="number" data-field="${field}" value="${Number(value).toFixed(options.precision ?? 0)}"
        min="${options.min ?? ""}" max="${options.max ?? ""}" step="${options.step ?? 1}" />
    </label>`;
}

function colorField(label, field, value, extra = "") {
  const safe = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return `
    <label class="field">
      <span>${label}</span>
      <span class="color-field">
        <input type="color" data-field="${field}" ${extra} value="${safe}" aria-label="${label} picker" />
        <input type="text" data-field="${field}" ${extra} value="${safe}" aria-label="${label} hex" spellcheck="false" />
      </span>
    </label>`;
}

function fillSection(object) {
  const fill = object.fill;
  const mode = fill?.type || "none";
  let controls = "";
  if (mode === "solid") {
    controls = `<div class="field-grid">${colorField("Color", "fillColor", fill.color)}</div>`;
  } else if (mode === "linear") {
    const stops = fill.stops
      .map((stop, index) => colorField(`Stop ${index + 1}`, "stopColor", stop.color, `data-index="${index}"`))
      .join("");
    const preview = `linear-gradient(${fill.angle + 90}deg, ${fill.stops
      .map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`)
      .join(", ")})`;
    controls = `
      <div class="gradient-preview" style="background:${preview}"></div>
      <div class="field-grid">
        ${stops}
        <label class="field field-wide">
          <span>Angle</span>
          <input type="number" data-field="gradientAngle" value="${Number(fill.angle).toFixed(0)}" min="0" max="360" step="1" />
        </label>
      </div>`;
  } else {
    controls = `<p class="stage-hint">This object has no fill. Choose Solid or Gradient to add one.</p>`;
  }

  return `
    <section class="inspector-section">
      <h3 class="section-title"><span>Fill</span></h3>
      <div class="fill-mode">
        <button data-fill-mode="none" class="${mode === "none" ? "is-active" : ""}">None</button>
        <button data-fill-mode="solid" class="${mode === "solid" ? "is-active" : ""}">Solid</button>
        <button data-fill-mode="linear" class="${mode === "linear" ? "is-active" : ""}">Gradient</button>
      </div>
      ${controls}
    </section>`;
}

function strokeSection(object) {
  const stroke = object.stroke || { color: "#282d3c", width: 0 };
  return `
    <section class="inspector-section">
      <h3 class="section-title"><span>Stroke</span><span>${stroke.width > 0 ? `${stroke.width}px` : "Off"}</span></h3>
      <div class="field-grid">
        ${colorField("Color", "strokeColor", stroke.color)}
        ${numberField("Width", "strokeWidth", stroke.width, { min: 0, max: 40, step: 0.5 })}
      </div>
    </section>`;
}

function opacitySection(object) {
  const opacity = object.opacity ?? 1;
  return `
    <section class="inspector-section">
      <h3 class="section-title"><span>Appearance</span></h3>
      <div class="range-row">
        <input type="range" data-field="opacity" value="${opacity}" min="0.05" max="1" step="0.01" aria-label="Opacity" />
        <span class="range-value">${Math.round(opacity * 100)}%</span>
      </div>
    </section>`;
}

function transformSection(object) {
  let controls = "";
  if (object.type === "rect") {
    controls = `
      ${numberField("X", "x", object.x, { precision: 2 })}
      ${numberField("Y", "y", object.y, { precision: 2 })}
      ${numberField("Width", "width", object.width, { min: 1, precision: 2 })}
      ${numberField("Height", "height", object.height, { min: 1, precision: 2 })}
      ${numberField("Corner", "radius", object.radius, { min: 0, precision: 2, wide: true })}`;
  } else if (object.type === "circle") {
    controls = `
      ${numberField("Center X", "x", object.x, { precision: 2 })}
      ${numberField("Center Y", "y", object.y, { precision: 2 })}
      ${numberField("Radius", "r", object.r, { min: 1, precision: 2, wide: true })}`;
  } else if (object.type === "path") {
    controls = `
      ${numberField("Start X", "pathX", object.points[0].x, { precision: 2 })}
      ${numberField("Start Y", "pathY", object.points[0].y, { precision: 2 })}
      <label class="field field-wide">
        <span>Path points</span>
        <input type="text" value="${object.points.length} points" readonly />
      </label>`;
  } else {
    controls = `
      ${numberField("X", "x", object.x, { precision: 2 })}
      ${numberField("Y", "y", object.y, { precision: 2 })}
      ${numberField("Size", "fontSize", object.fontSize, { min: 6, max: 240, precision: 0 })}
      ${numberField("Weight", "fontWeight", object.fontWeight, { min: 100, max: 900, step: 100 })}
      <label class="field field-wide">
        <span>Align</span>
        <select data-field="align">
          <option value="left" ${object.align === "left" ? "selected" : ""}>Left</option>
          <option value="center" ${object.align === "center" ? "selected" : ""}>Center</option>
          <option value="right" ${object.align === "right" ? "selected" : ""}>Right</option>
        </select>
      </label>`;
  }
  return `
    <section class="inspector-section">
      <h3 class="section-title"><span>Geometry</span><span>${object.type}</span></h3>
      <div class="field-grid">${controls}</div>
    </section>`;
}

function renderInspector() {
  const body = $("#inspector-body");
  const object = selectedObject();
  if (!object) {
    const gradientCount = state.scene.objects.filter((item) => item.fill?.type === "linear").length;
    const textCount = state.scene.objects.filter((item) => item.type === "text").length;
    body.innerHTML = `
      <div class="empty-inspector">
        <span class="inspector-orbit"></span>
        <strong>Nothing selected</strong>
        <p>Select a layer to tune its geometry, fill, hierarchy, and appearance.</p>
      </div>
      <section class="inspector-section">
        <h3 class="section-title"><span>Document</span></h3>
        <div class="field-grid">
          ${colorField("Background", "background", state.scene.canvas.background)}
        </div>
      </section>
      <section class="inspector-section">
        <h3 class="section-title"><span>Composition</span></h3>
        <div class="document-stats">
          <div class="stat-card"><span>Objects</span><strong>${state.scene.objects.length}</strong></div>
          <div class="stat-card"><span>Layers</span><strong>${state.scene.objects.length}</strong></div>
          <div class="stat-card"><span>Gradients</span><strong>${gradientCount}</strong></div>
          <div class="stat-card"><span>Text</span><strong>${textCount}</strong></div>
        </div>
      </section>`;
    return;
  }

  const textEditor =
    object.type === "text"
      ? `<section class="inspector-section">
          <h3 class="section-title"><span>Content</span><span>Editable</span></h3>
          <label class="field">
            <span>Text</span>
            <textarea data-field="text" spellcheck="false">${escapeHtml(object.text)}</textarea>
          </label>
        </section>`
      : "";
  const pathOptions =
    object.type === "path"
      ? `<section class="inspector-section">
          <label class="field">
            <span>Closed path</span>
            <select data-field="closed">
              <option value="false" ${!object.closed ? "selected" : ""}>Open</option>
              <option value="true" ${object.closed ? "selected" : ""}>Closed</option>
            </select>
          </label>
        </section>`
      : "";

  body.innerHTML = `
    <section class="inspector-section">
      <label class="field">
        <span>Layer name</span>
        <input type="text" data-field="name" value="${escapeHtml(object.name)}" spellcheck="false" />
      </label>
    </section>
    ${transformSection(object)}
    ${textEditor}
    ${fillSection(object)}
    ${strokeSection(object)}
    ${opacitySection(object)}
    ${pathOptions}
    <section class="inspector-section">
      <h3 class="section-title"><span>Arrange</span></h3>
      <div class="order-actions">
        <button class="soft-button" data-action="raise">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"/><path d="M12 9v11"/></svg>Raise
        </button>
        <button class="soft-button" data-action="lower">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/><path d="M12 4v11"/></svg>Lower
        </button>
        <button class="soft-button" data-action="duplicate" style="grid-column:1/-1">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M5 15V5h10"/></svg>Duplicate layer
        </button>
      </div>
    </section>`;
}

function ensureSolidFill(object) {
  if (object.fill?.type === "solid") return object.fill.color;
  if (object.fill?.type === "linear") return object.fill.stops[0].color;
  return "#5b5bd6";
}

function applyFillMode(object, mode) {
  if (mode === "none") {
    object.fill = null;
    return;
  }
  if (mode === "solid") {
    object.fill = { type: "solid", color: ensureSolidFill(object) };
    return;
  }
  const base = ensureSolidFill(object);
  object.fill = {
    type: "linear",
    angle: 35,
    stops: [
      { offset: 0, color: base },
      { offset: 0.55, color: "#7a4fb3" },
      { offset: 1, color: "#ef7b5b" }
    ]
  };
}

function onInspectorInput(event) {
  const target = event.target;
  const field = target.dataset.field;
  if (!field) return;
  const object = selectedObject();
  const numeric = target.type === "number" || target.type === "range";
  const value = numeric ? Number(target.value) : target.value;
  if (numeric && !Number.isFinite(value)) return;
  const colorFields = ["background", "fillColor", "stopColor", "strokeColor"];
  if (colorFields.includes(field) && !/^#[0-9a-f]{6}$/i.test(value)) return;

  if (field === "background" && !object) {
    if (/^#[0-9a-f]{6}$/i.test(value)) state.scene.canvas.background = value;
    renderCanvas();
    return;
  }
  if (!object) return;

  if (field === "name") object.name = value || `${object.type} layer`;
  else if (field === "x") object.x = value;
  else if (field === "y") object.y = value;
  else if (field === "width") object.width = Math.max(1, value);
  else if (field === "height") object.height = Math.max(1, value);
  else if (field === "radius") object.radius = Math.max(0, value);
  else if (field === "r") object.r = Math.max(1, value);
  else if (field === "pathX") {
    const delta = value - object.points[0].x;
    object.points.forEach((point) => {
      point.x += delta;
    });
  } else if (field === "pathY") {
    const delta = value - object.points[0].y;
    object.points.forEach((point) => {
      point.y += delta;
    });
  } else if (field === "fontSize") object.fontSize = Math.max(6, value);
  else if (field === "fontWeight") object.fontWeight = Math.max(100, Math.min(900, value));
  else if (field === "align") object.align = value;
  else if (field === "text") object.text = value;
  else if (field === "closed") object.closed = value === "true";
  else if (field === "fillColor") object.fill = { type: "solid", color: value };
  else if (field === "stopColor" && object.fill?.type === "linear") {
    const index = Number(target.dataset.index);
    if (object.fill.stops[index]) object.fill.stops[index].color = value;
  } else if (field === "gradientAngle" && object.fill?.type === "linear") {
    object.fill.angle = value;
  } else if (field === "strokeColor") {
    object.stroke = { ...(object.stroke || { width: 0 }), color: value };
  } else if (field === "strokeWidth") {
    object.stroke = { ...(object.stroke || { color: "#282d3c" }), width: Math.max(0, value) };
    const badge = target.closest(".inspector-section")?.querySelector(".section-title span:last-child");
    if (badge) badge.textContent = value > 0 ? `${value}px` : "Off";
  } else if (field === "opacity") {
    object.opacity = Math.max(0.05, Math.min(1, value));
    const output = target.closest(".range-row")?.querySelector(".range-value");
    if (output) output.textContent = `${Math.round(object.opacity * 100)}%`;
  }
  renderCanvas();
  renderLayers();
  updateStatus();
  if (target.type === "color" && colorFields.includes(field)) {
    const index = target.dataset.index;
    $$("[data-field]").forEach((input) => {
      if (
        input.dataset.field === field &&
        input.dataset.index === index &&
        input.type === "text"
      ) {
        input.value = value;
      }
    });
  }
}

function onInspectorClick(event) {
  const modeButton = event.target.closest("[data-fill-mode]");
  if (modeButton) {
    const object = selectedObject();
    if (!object) return;
    applyFillMode(object, modeButton.dataset.fillMode);
    renderAll();
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  const object = selectedObject();
  if (!object) return;
  if (action === "duplicate") {
    const copy = duplicateObject(object);
    state.scene.objects.splice(object.z + 1, 0, copy);
    state.scene = withZOrder(state.scene);
    state.selectedId = copy.id;
    renderAll();
    showToast(`Duplicated ${object.name}`);
  } else if (action === "raise" && object.z < state.scene.objects.length - 1) {
    const next = state.scene.objects[object.z + 1];
    state.scene.objects[object.z + 1] = object;
    state.scene.objects[object.z] = next;
    state.scene = withZOrder(state.scene);
    renderAll();
  } else if (action === "lower" && object.z > 0) {
    const previous = state.scene.objects[object.z - 1];
    state.scene.objects[object.z - 1] = object;
    state.scene.objects[object.z] = previous;
    state.scene = withZOrder(state.scene);
    renderAll();
  }
}

function addObject(object, options = {}) {
  state.scene.objects.push(object);
  state.scene = withZOrder(state.scene);
  state.selectedId = object.id;
  state.draft = null;
  renderAll();
  if (options.openText && object.type === "text") {
    requestAnimationFrame(() => openTextEntry(object));
  }
}

function deleteSelected() {
  const object = selectedObject();
  if (!object) return;
  state.scene.objects.splice(object.z, 1);
  state.scene = withZOrder(state.scene);
  state.selectedId = state.scene.objects[Math.max(0, object.z - 1)]?.id || null;
  hideTextEntry();
  renderAll();
  showToast(`Deleted ${object.name}`);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * state.scene.canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * state.scene.canvas.height
  };
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  const point = canvasPoint(event);

  if (state.tool === "path") {
    if (!state.pathDraft) state.pathDraft = { points: [], closed: false, hover: null };
    const last = state.pathDraft.points[state.pathDraft.points.length - 1];
    if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 5) {
      state.pathDraft.points.push(point);
    }
    state.pathDraft.hover = point;
    renderCanvas();
    return;
  }

  if (state.tool === "text") {
    const object = createText({
      x: point.x,
      y: point.y,
      text: "Editable text",
      fontSize: 42,
      name: "Live text"
    });
    addObject(object, { openText: true });
    setTool("select");
    return;
  }

  if (state.tool === "select") {
    const hit = hitTest(ctx, state.scene, point);
    if (hit) {
      selectObject(hit.id);
      state.move = {
        start: point,
        objectId: hit.id,
        original: structuredClone(hit),
        moved: false
      };
      canvas.setPointerCapture(event.pointerId);
    } else {
      selectObject(null);
    }
    return;
  }

  if (state.tool === "rect") {
    state.draft = createRect({
      x: point.x,
      y: point.y,
      width: 1,
      height: 1,
      radius: 12,
      name: "New rectangle"
    });
  } else if (state.tool === "circle") {
    state.draft = createCircle({
      x: point.x,
      y: point.y,
      r: 1,
      name: "New circle"
    });
  }
  state.shapeStart = point;
  canvas.setPointerCapture(event.pointerId);
  renderCanvas();
}

function onPointerMove(event) {
  const point = canvasPoint(event);
  if (state.pathDraft) {
    state.pathDraft.hover = point;
    renderCanvas();
    return;
  }
  if (state.draft && state.shapeStart) {
    if (state.draft.type === "rect") {
      state.draft.x = Math.min(state.shapeStart.x, point.x);
      state.draft.y = Math.min(state.shapeStart.y, point.y);
      state.draft.width = Math.max(1, Math.abs(point.x - state.shapeStart.x));
      state.draft.height = Math.max(1, Math.abs(point.y - state.shapeStart.y));
    } else if (state.draft.type === "circle") {
      state.draft.r = Math.max(1, Math.hypot(point.x - state.shapeStart.x, point.y - state.shapeStart.y));
    }
    renderCanvas();
    return;
  }
  if (state.move) {
    const object = state.scene.objects.find((item) => item.id === state.move.objectId);
    if (!object) return;
    const dx = point.x - state.move.start.x;
    const dy = point.y - state.move.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) state.move.moved = true;
    moveObjectFromOriginal(object, state.move.original, dx, dy);
    renderCanvas();
  }
}

function moveObjectFromOriginal(object, original, dx, dy) {
  if (object.type === "path") {
    object.points = original.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  } else {
    object.x = original.x + dx;
    object.y = original.y + dy;
  }
}

function onPointerUp() {
  if (state.draft) {
    const object = state.draft;
    const bigEnough =
      (object.type === "rect" && object.width > 4 && object.height > 4) ||
      (object.type === "circle" && object.r > 2);
    state.draft = null;
    state.shapeStart = null;
    if (bigEnough) {
      addObject(object);
      showToast(`${object.name} added`);
    } else {
      renderCanvas();
    }
  } else if (state.move) {
    const moved = state.move.moved;
    state.move = null;
    if (moved) renderAll();
  }
}

function finishPath(closed = false) {
  if (!state.pathDraft || state.pathDraft.points.length < 2) {
    state.pathDraft = null;
    renderCanvas();
    return;
  }
  const object = createPath({
    points: state.pathDraft.points.map((point) => ({ ...point })),
    closed,
    fill: closed
      ? {
          type: "linear",
          angle: 35,
          stops: [
            { offset: 0, color: "#5b5bd6" },
            { offset: 1, color: "#ef7b5b" }
          ]
        }
      : null,
    stroke: { color: "#3f9b72", width: 4 },
    name: closed ? "Closed path" : "Open path"
  });
  state.pathDraft = null;
  addObject(object);
}

function openTextEntry(object) {
  if (!object || object.type !== "text") return;
  if (state.selectedId !== object.id) selectObject(object.id);
  const entry = $("#text-entry");
  const input = $("#text-entry-input");
  const canvasRect = canvas.getBoundingClientRect();
  const matRect = canvasMat.getBoundingClientRect();
  const bounds = textMetrics(ctx, object).bounds;
  const scaleX = canvasRect.width / state.scene.canvas.width;
  const scaleY = canvasRect.height / state.scene.canvas.height;
  const left = canvasRect.left - matRect.left + bounds.x * scaleX;
  const top = canvasRect.top - matRect.top + bounds.y * scaleY;
  entry.style.left = `${Math.max(6, left - 2)}px`;
  entry.style.top = `${Math.max(6, top - 2)}px`;
  entry.style.width = `${Math.max(220, Math.min(420, bounds.width * scaleX + 50))}px`;
  entry.dataset.objectId = object.id;
  entry.classList.remove("is-hidden");
  input.value = object.text;
  input.style.font = `${object.fontWeight} ${Math.round(object.fontSize * scaleY)}px ${object.fontFamily}`;
  input.focus();
  input.select();
}

function hideTextEntry() {
  const entry = $("#text-entry");
  entry.classList.add("is-hidden");
  entry.dataset.objectId = "";
}

function onTextEntryInput(event) {
  const entry = $("#text-entry");
  const object = state.scene.objects.find((item) => item.id === entry.dataset.objectId);
  if (!object) return;
  object.text = event.target.value;
  renderCanvas();
  renderLayers();
}

function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2300);
}

function downloadText(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJSON() {
  const json = sceneToJSON(state.scene);
  downloadText(json, "vectra-scene.json", "application/json");
  showToast(`Saved ${state.scene.objects.length} objects as JSON`);
  return json;
}

function exportSVG() {
  const svg = sceneToSVG(state.scene);
  downloadText(svg, "vectra-scene.svg", "image/svg+xml");
  showToast("SVG exported with live text nodes");
  return svg;
}

async function importFile(file) {
  const text = await file.text();
  const scene = sceneFromJSON(text);
  setScene(scene);
  showToast(`Loaded ${scene.objects.length} objects from JSON`);
  return scene;
}

function randomScene(seed) {
  const randomSeed =
    seed ||
    crypto.getRandomValues(new Uint32Array(2)).join("-");
  const scene = generateRandomScene(`random-${randomSeed}`, 20);
  setScene(scene);
  showToast(`Generated ${scene.objects.length} vector objects`);
  return scene;
}

function applyZoom(nextZoom) {
  state.zoom = Math.max(0.6, Math.min(1.25, nextZoom));
  canvasMat.style.width = `${state.zoom * 100}%`;
  canvasMat.style.maxWidth = `${Math.round(state.scene.canvas.width * state.zoom)}px`;
  $("#zoom-label").textContent = `${Math.round(state.zoom * 100)}%`;
  requestAnimationFrame(resizeCanvas);
}

function onKeyDown(event) {
  const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
  if (event.key === "Escape") {
    hideTextEntry();
    state.draft = null;
    state.pathDraft = null;
    state.move = null;
    renderAll();
    return;
  }
  if (editing) return;

  const shortcut = event.key.toLowerCase();
  if (["v", "r", "o", "p", "t"].includes(shortcut)) {
    setTool({ v: "select", r: "rect", o: "circle", p: "path", t: "text" }[shortcut]);
  } else if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault();
    deleteSelected();
  } else if (event.key === "Enter" && state.pathDraft) {
    event.preventDefault();
    finishPath(event.shiftKey);
  } else if ((event.ctrlKey || event.metaKey) && shortcut === "d") {
    event.preventDefault();
    const object = selectedObject();
    if (object) {
      const copy = duplicateObject(object);
      state.scene.objects.splice(object.z + 1, 0, copy);
      state.scene = withZOrder(state.scene);
      state.selectedId = copy.id;
      renderAll();
    }
  }
}

function bindEvents() {
  $$(".tool-button").forEach((button) => {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  });
  $("#new-scene").addEventListener("click", () => {
    setScene(createScene([]));
    setTool("select");
    showToast("New page ready");
  });
  $("#random-scene").addEventListener("click", () => {
    randomScene();
    setTool("select");
  });
  $("#save-json").addEventListener("click", exportJSON);
  $("#load-json").addEventListener("click", () => $("#file-input").click());
  $("#export-svg").addEventListener("click", exportSVG);
  $("#file-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await importFile(file);
      setTool("select");
    } catch (error) {
      showToast(error.message, true);
    }
  });
  $("#delete-object").addEventListener("click", deleteSelected);
  $("#inspector-body").addEventListener("input", onInspectorInput);
  $("#inspector-body").addEventListener("click", onInspectorClick);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("dblclick", () => {
    if (state.tool === "path") {
      finishPath(false);
      return;
    }
    const object = selectedObject();
    if (object?.type === "text") openTextEntry(object);
  });
  $("#text-entry-input").addEventListener("input", onTextEntryInput);
  $("#text-entry-input").addEventListener("keydown", (event) => {
    if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) {
      event.preventDefault();
      hideTextEntry();
      renderAll();
    }
  });
  $("#text-entry-input").addEventListener("blur", () => {
    hideTextEntry();
    renderAll();
  });
  document.addEventListener("keydown", onKeyDown);
  $("#zoom-out").addEventListener("click", () => applyZoom(state.zoom - 0.1));
  $("#zoom-in").addEventListener("click", () => applyZoom(state.zoom + 0.1));
  new ResizeObserver(resizeCanvas).observe(canvas);
}

bindEvents();
setTool("select");
renderAll();
applyZoom(1);

window.vectorStudio = {
  version: 1,
  exportJSON: () => sceneToJSON(state.scene),
  importJSON: (text) => {
    const scene = sceneFromJSON(text);
    setScene(scene);
    return structuredClone(state.scene);
  },
  getScene: () => structuredClone(state.scene),
  loadScene: (scene) => {
    setScene(scene);
    return structuredClone(state.scene);
  },
  generate: (seed, count = 20) => {
    const scene = generateRandomScene(`api-${seed}`, count);
    setScene(scene);
    return structuredClone(state.scene);
  },
  newScene: () => {
    setScene(createScene([]));
    return structuredClone(state.scene);
  },
  select: (id) => {
    selectObject(id);
    return selectedObject()?.id || null;
  },
  clearSelection: () => selectObject(null),
  exportSVG,
  getStats: () => ({
    objects: state.scene.objects.length,
    selectedId: state.selectedId,
    canvas: { ...state.scene.canvas }
  }),
  renderNow: renderAll
};
