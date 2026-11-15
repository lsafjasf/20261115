(() => {
  "use strict";

  const EFFECTS = {
    ripple: {
      name: "波纹",
      label: "RIPPLE",
      color: "#72e6e0",
      summary: "径向折射 · 环形位移",
      params: [
        { key: "amplitude", label: "扭曲幅度", code: "AMP", min: 0.005, max: 0.12, step: 0.005, value: 0.045, digits: 3 },
        { key: "frequency", label: "波纹密度", code: "FREQ", min: 8, max: 52, step: 1, value: 26, digits: 0 },
        { key: "speed", label: "流动速度", code: "SPEED", min: 0.2, max: 4, step: 0.1, value: 1.4, digits: 1 },
      ],
    },
    fog: {
      name: "雾气",
      label: "FOG",
      color: "#baa5ff",
      summary: "体积噪波 · 柔光混合",
      params: [
        { key: "density", label: "雾气浓度", code: "DENSITY", min: 0, max: 1, step: 0.01, value: 0.58, digits: 2 },
        { key: "scale", label: "噪波尺度", code: "SCALE", min: 0.5, max: 7, step: 0.1, value: 2.4, digits: 1 },
        { key: "drift", label: "漂移速度", code: "DRIFT", min: 0, max: 2.5, step: 0.1, value: 0.65, digits: 1 },
      ],
    },
    dots: {
      name: "点阵",
      label: "DOT MATRIX",
      color: "#ffc76a",
      summary: "半调采样 · 网格重组",
      params: [
        { key: "cell", label: "网点尺寸", code: "CELL", min: 2, max: 20, step: 1, value: 9, digits: 0 },
        { key: "strength", label: "点阵强度", code: "MIX", min: 0.2, max: 1, step: 0.01, value: 0.64, digits: 2 },
        { key: "contrast", label: "亮度对比", code: "GAMMA", min: 0.5, max: 2, step: 0.05, value: 1.15, digits: 2 },
      ],
    },
  };

  const STORAGE_KEY = "prism-lab.effect-chains.v1";
  const MAX_CHAIN_LENGTH = 8;
  const MAX_SAVED_CHAINS = 12;
  const MAX_RENDER_PIXELS = 2100000;
  const DEFAULT_CHAIN = ["ripple", "fog", "dots"];

  let sequence = 0;
  let renderer = null;
  let toastTimer = 0;

  const state = {
    chain: [],
    selectedId: null,
    saved: [],
    paused: false,
  };

  const dom = {
    canvas: document.querySelector("#glCanvas"),
    canvasFrame: document.querySelector("#canvasFrame"),
    effectChain: document.querySelector("#effectChain"),
    effectLibrary: document.querySelector("#effectLibrary"),
    chainCount: document.querySelector("#chainCount"),
    chainEmpty: document.querySelector("#chainEmpty"),
    paramControls: document.querySelector("#paramControls"),
    activeEffectPill: document.querySelector("#activeEffectPill"),
    savedList: document.querySelector("#savedList"),
    savedCount: document.querySelector("#savedCount"),
    saveForm: document.querySelector("#saveForm"),
    saveName: document.querySelector("#saveName"),
    resetChainButton: document.querySelector("#resetChainButton"),
    pauseButton: document.querySelector("#pauseButton"),
    screenshotButton: document.querySelector("#screenshotButton"),
    fpsValue: document.querySelector("#fpsValue"),
    resolutionBadge: document.querySelector("#resolutionBadge"),
    renderMode: document.querySelector("#renderMode"),
    canvasChain: document.querySelector("#canvasChain"),
    webglError: document.querySelector("#webglError"),
    toastRegion: document.querySelector("#toastRegion"),
  };

  function nextId() {
    sequence += 1;
    return `fx-${Date.now().toString(36)}-${sequence}`;
  }

  function createEffect(type, overrides = {}) {
    const definition = EFFECTS[type];
    if (!definition) {
      throw new Error(`Unknown effect type: ${type}`);
    }
    const params = {};
    for (const param of definition.params) {
      const candidate = overrides.params?.[param.key];
      const numeric = Number(candidate);
      params[param.key] = Number.isFinite(numeric)
        ? Math.min(param.max, Math.max(param.min, numeric))
        : param.value;
    }
    return {
      id: nextId(),
      type,
      enabled: overrides.enabled !== false,
      params,
    };
  }

  function createDefaultChain() {
    return DEFAULT_CHAIN.map((type) => createEffect(type));
  }

  function serializeChain(chain = state.chain) {
    return chain.map((effect) => ({
      type: effect.type,
      enabled: effect.enabled,
      params: { ...effect.params },
    }));
  }

  function cloneChainForRestore(chain) {
    if (!Array.isArray(chain)) {
      return [];
    }
    return chain
      .filter((effect) => effect && EFFECTS[effect.type])
      .slice(0, MAX_CHAIN_LENGTH)
      .map((effect) => createEffect(effect.type, effect));
  }

  function readSavedChains() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((entry) => entry && typeof entry.name === "string" && Array.isArray(entry.chain))
        .slice(0, MAX_SAVED_CHAINS);
    } catch (error) {
      console.warn("Unable to read saved effect chains.", error);
      return [];
    }
  }

  function persistSavedChains() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.saved));
      return true;
    } catch (error) {
      console.warn("Unable to persist effect chains.", error);
      showToast("浏览器阻止了本地存储，请通过本地服务器打开页面。");
      return false;
    }
  }

  function selectedEffect() {
    return state.chain.find((effect) => effect.id === state.selectedId) ?? null;
  }

  function activeEffectCount() {
    return state.chain.filter((effect) => effect.enabled).length;
  }

  function formatParam(param, value) {
    return Number(value).toFixed(param.digits);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    dom.toastRegion.replaceChildren();
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    dom.toastRegion.append(toast);
    toastTimer = window.setTimeout(() => {
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.remove(), 190);
    }, 2400);
  }

  function requestRender() {
    renderer?.requestRender();
  }

  function effectSummary(effect) {
    const definition = EFFECTS[effect.type];
    const values = definition.params
      .slice(0, 2)
      .map((param) => `${param.code} ${formatParam(param, effect.params[param.key])}`);
    return `${definition.label} · ${values.join(" / ")}`;
  }

  function renderChain() {
    dom.effectChain.replaceChildren();
    dom.chainEmpty.hidden = state.chain.length > 0;

    state.chain.forEach((effect, index) => {
      const definition = EFFECTS[effect.type];
      const item = document.createElement("li");
      item.className = "effect-item";
      item.dataset.id = effect.id;
      item.dataset.type = effect.type;
      item.classList.toggle("is-selected", effect.id === state.selectedId);
      item.classList.toggle("is-enabled", effect.enabled);

      const select = document.createElement("button");
      select.type = "button";
      select.className = "effect-select";
      select.dataset.action = "select";
      select.setAttribute("aria-label", `选择${definition.name}效果并编辑参数`);
      select.innerHTML = `
        <span class="effect-order">${String(index + 1).padStart(2, "0")}</span>
        <span class="effect-copy">
          <strong>${definition.name}</strong>
          <small>${effectSummary(effect)}</small>
        </span>
        <span class="effect-meta" title="${effect.enabled ? "已启用" : "已停用"}">
          <span class="enabled-dot"></span>
        </span>
      `;

      const actions = document.createElement("div");
      actions.className = "effect-actions";
      actions.innerHTML = `
        <button class="mini-button" type="button" data-action="up"
          aria-label="上移${definition.name}" title="上移" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="mini-button" type="button" data-action="down"
          aria-label="下移${definition.name}" title="下移"
          ${index === state.chain.length - 1 ? "disabled" : ""}>↓</button>
        <button class="mini-button" type="button" data-action="toggle"
          aria-label="${effect.enabled ? "停用" : "启用"}${definition.name}"
          title="${effect.enabled ? "停用" : "启用"}">${effect.enabled ? "●" : "○"}</button>
        <button class="mini-button" type="button" data-action="remove"
          aria-label="移除${definition.name}" title="移除">×</button>
      `;

      item.append(select, actions);
      dom.effectChain.append(item);
    });
  }

  function updateSliderFill(input, param) {
    const value = Number(input.value);
    const percent = ((value - param.min) / (param.max - param.min)) * 100;
    input.style.setProperty("--range-fill", `${Math.max(0, Math.min(100, percent))}%`);
  }

  function renderParams() {
    const effect = selectedEffect();
    dom.paramControls.replaceChildren();

    if (!effect) {
      dom.activeEffectPill.textContent = "未选择";
      dom.activeEffectPill.style.removeProperty("--active-color");
      const empty = document.createElement("p");
      empty.className = "param-empty";
      empty.textContent = state.chain.length
        ? "点击上方任意效果查看并调整参数。"
        : "添加效果后，可在这里实时调整参数。";
      dom.paramControls.append(empty);
      return;
    }

    const definition = EFFECTS[effect.type];
    dom.activeEffectPill.textContent = `${definition.name} / ${definition.label}`;
    dom.activeEffectPill.style.setProperty("--active-color", definition.color);

    for (const param of definition.params) {
      const row = document.createElement("div");
      row.className = "param-row";
      row.style.setProperty("--range-color", definition.color);

      const label = document.createElement("label");
      label.htmlFor = `param-${effect.id}-${param.key}`;
      label.innerHTML = `<span>${param.label} <small>${param.code}</small></span>`;

      const output = document.createElement("output");
      output.className = "param-value";
      output.htmlFor = label.htmlFor;
      output.textContent = formatParam(param, effect.params[param.key]);

      const input = document.createElement("input");
      input.type = "range";
      input.id = label.htmlFor;
      input.dataset.param = param.key;
      input.min = String(param.min);
      input.max = String(param.max);
      input.step = String(param.step);
      input.value = String(effect.params[param.key]);
      input.setAttribute("aria-label", `${definition.name}${param.label}`);
      updateSliderFill(input, param);

      row.append(label, output, input);
      dom.paramControls.append(row);
    }
  }

  function renderCanvasChain() {
    dom.canvasChain.replaceChildren();
    const enabled = state.chain.filter((effect) => effect.enabled);
    if (!enabled.length) {
      const base = document.createElement("span");
      base.style.setProperty("--chip-color", "#8f988f");
      base.textContent = "BASE ONLY";
      dom.canvasChain.append(base);
      return;
    }

    enabled.forEach((effect, index) => {
      if (index > 0) {
        const arrow = document.createElement("i");
        arrow.textContent = "›";
        dom.canvasChain.append(arrow);
      }
      const chip = document.createElement("span");
      chip.style.setProperty("--chip-color", EFFECTS[effect.type].color);
      chip.textContent = `${String(index + 1).padStart(2, "0")} ${EFFECTS[effect.type].name}`;
      dom.canvasChain.append(chip);
    });
  }

  function renderCounts() {
    const enabledCount = activeEffectCount();
    dom.chainCount.textContent = `${enabledCount} PASS`;
    dom.renderMode.textContent = `${enabledCount} PASS`;
    dom.savedCount.textContent = `${state.saved.length} SLOT`;
  }

  function renderSavedChains() {
    dom.savedList.replaceChildren();
    if (!state.saved.length) {
      const empty = document.createElement("p");
      empty.className = "saved-empty";
      empty.textContent = "还没有存档 · 当前效果链可随时保存";
      dom.savedList.append(empty);
      return;
    }

    for (const entry of state.saved) {
      const item = document.createElement("div");
      item.className = "saved-item";
      item.dataset.id = entry.id;

      const copy = document.createElement("div");
      copy.className = "saved-copy";
      const title = document.createElement("strong");
      title.textContent = entry.name;
      const meta = document.createElement("small");
      const chainLabel = entry.chain
        .filter((effect) => effect.enabled && EFFECTS[effect.type])
        .map((effect) => EFFECTS[effect.type].name)
        .join(" → ");
      const savedDate = new Date(entry.savedAt);
      const dateLabel = Number.isNaN(savedDate.getTime())
        ? ""
        : ` · ${savedDate.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}`;
      meta.textContent = `${chainLabel || "空效果链"}${dateLabel}`;
      meta.title = meta.textContent;
      copy.append(title, meta);

      const load = document.createElement("button");
      load.type = "button";
      load.className = "load-button";
      load.dataset.action = "load";
      load.textContent = "载入";
      load.setAttribute("aria-label", `载入效果链 ${entry.name}`);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-button";
      remove.dataset.action = "delete";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `删除效果链 ${entry.name}`);

      item.append(copy, load, remove);
      dom.savedList.append(item);
    }
  }

  function renderAll() {
    renderChain();
    renderParams();
    renderCanvasChain();
    renderCounts();
    requestRender();
  }

  function syncPauseButton() {
    const label = dom.pauseButton.querySelector(".button-label");
    const nextLabel = state.paused ? "继续" : "暂停";
    dom.pauseButton.setAttribute("aria-pressed", String(state.paused));
    dom.pauseButton.setAttribute("aria-label", state.paused ? "继续动画" : "暂停动画");
    if (label) {
      label.textContent = nextLabel;
    }
  }

  function setPaused(paused, timeOverride = null) {
    state.paused = Boolean(paused);
    if (renderer) {
      if (state.paused) {
        renderer.pause(typeof timeOverride === "number" ? timeOverride : undefined);
      } else {
        renderer.resume();
      }
    }
    syncPauseButton();
  }

  function selectEffect(id) {
    if (!state.chain.some((effect) => effect.id === id)) {
      return;
    }
    state.selectedId = id;
    renderChain();
    renderParams();
  }

  function addEffect(type) {
    if (!EFFECTS[type]) {
      return;
    }
    if (state.chain.length >= MAX_CHAIN_LENGTH) {
      showToast(`效果链最多叠加 ${MAX_CHAIN_LENGTH} 层。`);
      return;
    }
    const effect = createEffect(type);
    state.chain.push(effect);
    state.selectedId = effect.id;
    renderAll();
    showToast(`已添加「${EFFECTS[type].name}」到效果链末尾。`);
  }

  function moveEffect(id, direction) {
    const index = state.chain.findIndex((effect) => effect.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= state.chain.length) {
      return;
    }
    [state.chain[index], state.chain[target]] = [state.chain[target], state.chain[index]];
    state.selectedId = id;
    renderAll();
  }

  function removeEffect(id) {
    const index = state.chain.findIndex((effect) => effect.id === id);
    if (index < 0) {
      return;
    }
    const [removed] = state.chain.splice(index, 1);
    if (state.selectedId === id) {
      const neighbor = state.chain[index] ?? state.chain[index - 1] ?? null;
      state.selectedId = neighbor?.id ?? null;
    }
    renderAll();
    showToast(`已移除「${EFFECTS[removed.type].name}」，画面已从基础层重新合成。`);
  }

  function toggleEffect(id) {
    const effect = state.chain.find((item) => item.id === id);
    if (!effect) {
      return;
    }
    effect.enabled = !effect.enabled;
    renderAll();
    showToast(`「${EFFECTS[effect.type].name}」已${effect.enabled ? "启用" : "停用"}。`);
  }

  function resetChain() {
    state.chain = createDefaultChain();
    state.selectedId = state.chain[0]?.id ?? null;
    renderAll();
    showToast("已恢复波纹 → 雾气 → 点阵示例链。");
  }

  function saveCurrentChain(event) {
    event?.preventDefault();
    if (!state.chain.length) {
      showToast("空效果链无法保存，请先添加至少一层效果。");
      return;
    }
    const name = dom.saveName.value.trim() || `效果链 ${state.saved.length + 1}`;
    const entry = {
      id: `preset-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`,
      name: name.slice(0, 32),
      savedAt: new Date().toISOString(),
      chain: serializeChain(),
    };
    state.saved.unshift(entry);
    state.saved = state.saved.slice(0, MAX_SAVED_CHAINS);
    if (!persistSavedChains()) {
      state.saved.shift();
      renderSavedChains();
      return;
    }
    dom.saveName.value = "";
    renderSavedChains();
    renderCounts();
    showToast(`「${entry.name}」已保存，参数与顺序已写入本地。`);
  }

  function loadSavedChain(id) {
    const entry = state.saved.find((item) => item.id === id);
    if (!entry) {
      return;
    }
    state.chain = cloneChainForRestore(entry.chain);
    state.selectedId = state.chain[0]?.id ?? null;
    dom.saveName.value = entry.name;
    renderAll();
    showToast(`已载入「${entry.name}」，页面已按原顺序恢复合成。`);
  }

  function deleteSavedChain(id) {
    const entry = state.saved.find((item) => item.id === id);
    if (!entry) {
      return;
    }
    state.saved = state.saved.filter((item) => item.id !== id);
    persistSavedChains();
    renderSavedChains();
    renderCounts();
    showToast(`已删除存档「${entry.name}」。`);
  }

  function screenshotFilename() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `prism-lab-${stamp}.png`;
  }

  function downloadScreenshot() {
    if (!renderer) {
      showToast("WebGL 尚未就绪，无法截图。");
      return;
    }
    renderer.refresh();
    dom.canvas.toBlob((blob) => {
      if (!blob) {
        showToast("截图导出失败，请重试。");
        return;
      }
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = screenshotFilename();
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      showToast("当前合成画面已导出为 PNG。");
    }, "image/png");
  }

  function updateFrameStats({ fps, width, height }) {
    dom.fpsValue.textContent = String(Math.max(0, Math.round(fps)));
    dom.resolutionBadge.textContent = `${width} × ${height}`;
  }

  dom.effectLibrary.addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-effect]");
    if (button) {
      addEffect(button.dataset.addEffect);
    }
  });

  dom.effectChain.addEventListener("click", (event) => {
    const item = event.target.closest(".effect-item");
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!item || !action) {
      return;
    }
    const id = item.dataset.id;
    if (action === "select") {
      selectEffect(id);
    } else if (action === "up") {
      moveEffect(id, -1);
    } else if (action === "down") {
      moveEffect(id, 1);
    } else if (action === "toggle") {
      toggleEffect(id);
    } else if (action === "remove") {
      removeEffect(id);
    }
  });

  dom.paramControls.addEventListener("input", (event) => {
    const input = event.target.closest("input[data-param]");
    const effect = selectedEffect();
    if (!input || !effect) {
      return;
    }
    const definition = EFFECTS[effect.type];
    const param = definition.params.find((candidate) => candidate.key === input.dataset.param);
    if (!param) {
      return;
    }
    const value = Number(input.value);
    effect.params[param.key] = value;
    updateSliderFill(input, param);
    const output = input.closest(".param-row")?.querySelector(".param-value");
    if (output) {
      output.textContent = formatParam(param, value);
    }
    const itemCopy = dom.effectChain.querySelector(
      `.effect-item[data-id="${effect.id}"] .effect-copy small`,
    );
    if (itemCopy) {
      itemCopy.textContent = effectSummary(effect);
    }
    requestRender();
  });

  dom.savedList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    const item = event.target.closest(".saved-item");
    if (!button || !item) {
      return;
    }
    if (button.dataset.action === "load") {
      loadSavedChain(item.dataset.id);
    } else if (button.dataset.action === "delete") {
      deleteSavedChain(item.dataset.id);
    }
  });

  dom.saveForm.addEventListener("submit", saveCurrentChain);
  dom.resetChainButton.addEventListener("click", resetChain);
  dom.pauseButton.addEventListener("click", () => setPaused(!state.paused));
  dom.screenshotButton.addEventListener("click", downloadScreenshot);

  window.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target.closest("input, textarea, select, button")) {
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      setPaused(!state.paused);
    }
  });

  const VERTEX_SHADER = `#version 300 es
    layout(location = 0) in vec2 a_position;
    out vec2 v_uv;

    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  class ShaderRenderer {
    constructor(canvas, callbacks = {}) {
      this.canvas = canvas;
      this.onStats = callbacks.onStats ?? (() => {});
      this.gl = canvas.getContext("webgl2", {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
      if (!this.gl) {
        throw new Error("WebGL2 is not available.");
      }

      this.width = 0;
      this.height = 0;
      this.dirty = true;
      this.paused = false;
      this.pausedAt = 0;
      this.elapsedBeforePause = 0;
      this.activeSince = performance.now();
      this.fps = 60;
      this.fpsSamples = [];
      this.lastFrameAt = 0;
      this.lastStatsAt = 0;
      this.targets = null;
      this.rafId = 0;

      this.configureContext();
      this.createQuad();
      this.createPrograms();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas.parentElement ?? canvas);
      this.resize(true);
      this.loop = this.loop.bind(this);
      this.rafId = requestAnimationFrame(this.loop);
    }

    configureContext() {
      const gl = this.gl;
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    }

    createQuad() {
      const gl = this.gl;
      this.quadBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }

    compileShader(type, source) {
      const gl = this.gl;
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || "Unknown shader compile error.";
        gl.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    }

    createProgram(fragmentSource, uniformNames = []) {
      const gl = this.gl;
      const vertex = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
      const fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
      const program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program) || "Unknown shader link error.";
        gl.deleteProgram(program);
        throw new Error(message);
      }
      const uniforms = {
        u_tex: gl.getUniformLocation(program, "u_tex"),
        u_res: gl.getUniformLocation(program, "u_res"),
        u_time: gl.getUniformLocation(program, "u_time"),
        u_aspect: gl.getUniformLocation(program, "u_aspect"),
      };
      for (const name of uniformNames) {
        uniforms[name] = gl.getUniformLocation(program, name);
      }
      return { program, uniforms };
    }

    createRenderTarget() {
      const gl = this.gl;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        this.width,
        this.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );

      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      );
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Incomplete framebuffer: ${status}`);
      }
      return { texture, framebuffer };
    }

    destroyTargets() {
      if (!this.targets) {
        return;
      }
      const gl = this.gl;
      for (const target of this.targets.all) {
        gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.framebuffer);
      }
      this.targets = null;
    }

    resize(force = false) {
      const bounds = this.canvas.parentElement?.getBoundingClientRect() ?? this.canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) {
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      let width = Math.max(1, Math.round(bounds.width * dpr));
      let height = Math.max(1, Math.round(bounds.height * dpr));
      const pixels = width * height;
      if (pixels > MAX_RENDER_PIXELS) {
        const scale = Math.sqrt(MAX_RENDER_PIXELS / pixels);
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
      }
      if (!force && width === this.width && height === this.height) {
        return;
      }
      this.width = width;
      this.height = height;
      this.canvas.width = width;
      this.canvas.height = height;
      this.destroyTargets();
      const base = this.createRenderTarget();
      const pingA = this.createRenderTarget();
      const pingB = this.createRenderTarget();
      this.targets = {
        base,
        ping: [pingA, pingB],
        all: [base, pingA, pingB],
      };
      this.dirty = true;
      this.onStats({ fps: this.fps, width, height });
    }

    currentTime(now = performance.now()) {
      if (this.paused) {
        return this.pausedAt;
      }
      return this.elapsedBeforePause + (now - this.activeSince) / 1000;
    }

    pause(atTime) {
      this.pausedAt = typeof atTime === "number" ? atTime : this.currentTime();
      this.paused = true;
      this.dirty = true;
      this.refresh();
    }

    resume() {
      this.elapsedBeforePause = this.pausedAt;
      this.activeSince = performance.now();
      this.paused = false;
      this.dirty = true;
    }

    requestRender() {
      this.dirty = true;
    }

    createPrograms() {
      this.programs = {
        base: this.createProgram(BASE_FRAGMENT_SHADER),
        display: this.createProgram(DISPLAY_FRAGMENT_SHADER),
        ripple: this.createProgram(RIPPLE_FRAGMENT_SHADER, [
          "u_amplitude",
          "u_frequency",
          "u_speed",
        ]),
        fog: this.createProgram(FOG_FRAGMENT_SHADER, ["u_density", "u_scale", "u_drift"]),
        dots: this.createProgram(DOT_FRAGMENT_SHADER, ["u_cell", "u_strength", "u_contrast"]),
      };
    }

    setCommonUniforms(program, time, sourceTexture = null) {
      const gl = this.gl;
      gl.useProgram(program.program);
      gl.uniform2f(program.uniforms.u_res, this.width, this.height);
      gl.uniform1f(program.uniforms.u_time, time);
      gl.uniform1f(program.uniforms.u_aspect, this.width / this.height);
      if (sourceTexture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        gl.uniform1i(program.uniforms.u_tex, 0);
      }
    }

    drawQuad() {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    bindTarget(target) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    effectProgram(effect) {
      const entry = this.programs[effect.type];
      if (!entry) {
        return null;
      }
      return entry;
    }

    renderAt(time) {
      if (!this.targets || !this.width || !this.height) {
        return;
      }
      const gl = this.gl;
      const targets = this.targets;

      this.bindTarget(targets.base);
      const baseProgram = this.programs.base;
      this.setCommonUniforms(baseProgram, time);
      this.drawQuad();

      let sourceTexture = targets.base.texture;
      let pingIndex = 0;
      for (const effect of state.chain) {
        if (!effect.enabled || !EFFECTS[effect.type]) {
          continue;
        }
        const target = targets.ping[pingIndex];
        this.bindTarget(target);
        const program = this.effectProgram(effect);
        if (!program) {
          pingIndex = 1 - pingIndex;
          continue;
        }
        this.setCommonUniforms(program, time, sourceTexture);
        const glProgram = program;
        const params = effect.params;
        if (effect.type === "ripple") {
          gl.uniform1f(glProgram.uniforms.u_amplitude, params.amplitude);
          gl.uniform1f(glProgram.uniforms.u_frequency, params.frequency);
          gl.uniform1f(glProgram.uniforms.u_speed, params.speed);
        } else if (effect.type === "fog") {
          gl.uniform1f(glProgram.uniforms.u_density, params.density);
          gl.uniform1f(glProgram.uniforms.u_scale, params.scale);
          gl.uniform1f(glProgram.uniforms.u_drift, params.drift);
        } else if (effect.type === "dots") {
          gl.uniform1f(glProgram.uniforms.u_cell, params.cell);
          gl.uniform1f(glProgram.uniforms.u_strength, params.strength);
          gl.uniform1f(glProgram.uniforms.u_contrast, params.contrast);
        }
        this.drawQuad();
        sourceTexture = target.texture;
        pingIndex = 1 - pingIndex;
      }

      this.bindTarget(null);
      const display = this.programs.display;
      this.setCommonUniforms(display, time, sourceTexture);
      this.drawQuad();
      gl.flush();
    }

    loop(now) {
      const elapsed = now - this.lastFrameAt;
      if (!this.paused && elapsed > 0) {
        this.fpsSamples.push(1000 / elapsed);
        if (this.fpsSamples.length > 30) {
          this.fpsSamples.shift();
        }
        this.fps = this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length;
        this.lastFrameAt = now;
        if (now - this.lastStatsAt > 420) {
          this.lastStatsAt = now;
          this.onStats({ fps: this.fps, width: this.width, height: this.height });
        }
        this.dirty = true;
      } else {
        this.lastFrameAt = now;
      }
      if (this.dirty) {
        this.renderAt(this.currentTime(now));
        this.dirty = false;
      }
      this.rafId = requestAnimationFrame(this.loop);
    }

    refresh() {
      this.renderAt(this.paused ? this.pausedAt : this.currentTime());
      this.onStats({
        fps: this.paused ? this.fps : this.fps,
        width: this.width,
        height: this.height,
      });
    }

    snapshotDataURL() {
      this.refresh();
      return this.canvas.toDataURL("image/png");
    }

    getStatus() {
      return {
        fps: Number(this.fps.toFixed(2)),
        width: this.width,
        height: this.height,
        paused: this.paused,
      };
    }
  }

  const BASE_FRAGMENT_SHADER = `#version 300 es
    precision highp float;

    uniform vec2 u_res;
    uniform float u_time;
    uniform float u_aspect;
    out vec4 out_color;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash12(i);
      float b = hash12(i + vec2(1.0, 0.0));
      float c = hash12(i + vec2(0.0, 1.0));
      float d = hash12(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p);
        p *= 2.03;
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_res;
      vec2 p = (uv - 0.5) * vec2(u_aspect, 1.0);
      float t = u_time;

      vec3 deep = vec3(0.010, 0.027, 0.039);
      vec3 mid = vec3(0.020, 0.088, 0.085);
      vec3 upper = vec3(0.035, 0.050, 0.058);
      vec3 color = mix(deep, mid, smoothstep(0.92, 0.05, uv.y));
      color = mix(color, upper, smoothstep(0.52, 1.0, uv.y) * 0.42);

      vec2 orb = vec2(0.24, 0.19);
      float orbDistance = length(p - orb);
      float aura = exp(-orbDistance * 4.4);
      color += vec3(0.10, 0.46, 0.39) * aura * 0.47;
      color += vec3(0.48, 0.19, 0.11) * exp(-length(p - orb - vec2(0.17, -0.10)) * 6.2) * 0.28;

      float disc = 1.0 - smoothstep(0.132, 0.137, orbDistance);
      float inner = 1.0 - smoothstep(0.115, 0.120, length(p - orb - vec2(-0.045, 0.030)));
      color = mix(color, vec3(0.97, 0.58, 0.30), disc * 0.94);
      color = mix(color, vec3(0.015, 0.045, 0.050), inner * 0.94);
      float rim = 1.0 - smoothstep(0.0025, 0.0075, abs(orbDistance - 0.144));
      color += vec3(1.0, 0.37, 0.18) * rim * 0.73;

      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float wave = sin(p.x * (1.8 + fi * 0.55) + t * (0.22 + fi * 0.06) + fi * 1.7);
        wave += sin(p.x * 4.3 - t * 0.15 + fi) * 0.22;
        wave += (fbm(vec2(p.x * 1.8 + fi, fi * 3.7 + t * 0.04)) - 0.5) * 0.62;
        float center = -0.19 + fi * 0.105 + wave * 0.07;
        float ribbon = 1.0 - smoothstep(0.005, 0.022 + fi * 0.004, abs(p.y - center));
        vec3 ribbonColor = mix(vec3(0.08, 0.61, 0.53), vec3(0.54, 0.35, 0.78), fi / 3.0);
        color += ribbonColor * ribbon * (0.24 - fi * 0.025);
        float edge = 1.0 - smoothstep(0.001, 0.004, abs(p.y - center - 0.012));
        color += vec3(0.66, 0.95, 0.76) * edge * 0.09;
      }

      vec2 glowCenter = vec2(-0.26, -0.31);
      float lowerGlow = exp(-length(p - glowCenter) * 3.4);
      color += vec3(0.04, 0.28, 0.27) * lowerGlow * 0.48;

      float floorMask = 1.0 - smoothstep(-0.47, 0.13, p.y);
      vec2 grid = vec2(p.x * 10.5, (0.19 - p.y) * 15.5 - t * 0.16);
      vec2 cell = abs(fract(grid) - 0.5);
      float line = 1.0 - smoothstep(0.455, 0.497, max(cell.x, cell.y));
      float fade = 1.0 - smoothstep(-0.38, 0.08, p.y);
      color += vec3(0.15, 0.62, 0.54) * line * floorMask * fade * 0.15;

      vec2 starCell = floor(uv * u_res / 17.0);
      vec2 starLocal = fract(uv * u_res / 17.0) - 0.5;
      float starRandom = hash12(starCell);
      float star = 1.0 - smoothstep(0.08, 0.17, length(starLocal));
      color += vec3(0.74, 0.89, 0.73) * star * step(0.965, starRandom) * 0.75;

      float grain = (hash12(uv * u_res + fract(t) * 73.0) - 0.5) * 0.017;
      color += grain;
      float vignette = smoothstep(1.22, 0.32, length(p));
      color *= mix(0.64, 1.0, vignette);
      color = pow(max(color, 0.0), vec3(0.92));
      out_color = vec4(color, 1.0);
    }
  `;

  const RIPPLE_FRAGMENT_SHADER = `#version 300 es
    precision highp float;

    uniform sampler2D u_tex;
    uniform vec2 u_res;
    uniform float u_time;
    uniform float u_aspect;
    uniform float u_amplitude;
    uniform float u_frequency;
    uniform float u_speed;
    out vec4 out_color;

    void main() {
      vec2 uv = gl_FragCoord.xy / u_res;
      vec2 center = vec2(0.50, 0.51);
      vec2 delta = (uv - center) * vec2(u_aspect, 1.0);
      float distanceFromCenter = length(delta);
      vec2 direction = delta / max(distanceFromCenter, 0.0001);
      float falloff = 1.0 - smoothstep(0.02, 0.72, distanceFromCenter);
      float phase = distanceFromCenter * u_frequency - u_time * u_speed * 2.4;
      float wave = sin(phase) * cos(phase * 0.47 + 0.7) * falloff;
      vec2 offset = direction * wave * u_amplitude / vec2(u_aspect, 1.0);

      float split = (sin(phase * 1.37) * 0.0022 + wave * 0.0045) * falloff;
      vec2 splitOffset = direction * split / vec2(u_aspect, 1.0);
      vec2 sampleUv = clamp(uv + offset, vec2(0.001), vec2(0.999));
      vec3 color;
      color.r = texture(u_tex, clamp(sampleUv + splitOffset, 0.001, 0.999)).r;
      color.g = texture(u_tex, sampleUv).g;
      color.b = texture(u_tex, clamp(sampleUv - splitOffset, 0.001, 0.999)).b;

      float crest = pow(max(0.0, sin(phase)), 8.0) * falloff;
      float trough = pow(max(0.0, -sin(phase)), 10.0) * falloff;
      color += vec3(0.20, 0.58, 0.57) * crest * 0.12;
      color -= vec3(0.01, 0.045, 0.045) * trough * 0.38;
      float rimLight = smoothstep(0.70, 0.43, distanceFromCenter) *
        smoothstep(0.40, 0.68, distanceFromCenter);
      color += vec3(0.10, 0.28, 0.26) * rimLight * abs(wave) * 0.10;
      out_color = vec4(color, 1.0);
    }
  `;

  const FOG_FRAGMENT_SHADER = `#version 300 es
    precision highp float;

    uniform sampler2D u_tex;
    uniform vec2 u_res;
    uniform float u_time;
    uniform float u_aspect;
    uniform float u_density;
    uniform float u_scale;
    uniform float u_drift;
    out vec4 out_color;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash12(i);
      float b = hash12(i + vec2(1.0, 0.0));
      float c = hash12(i + vec2(0.0, 1.0));
      float d = hash12(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.52;
      for (int i = 0; i < 5; i++) {
        value += amplitude * noise(p);
        p = p * 2.02 + vec2(7.1, 3.7);
        amplitude *= 0.49;
      }
      return value;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_res;
      vec2 p = uv * vec2(u_aspect, 1.0) * u_scale;
      float t = u_time * u_drift;
      float driftNoise = fbm(p + vec2(t * 0.19, -t * 0.07));
      float fineNoise = fbm(p * 2.15 + vec2(-t * 0.11, t * 0.13));
      float density = clamp(u_density, 0.0, 1.0);
      float wisps = smoothstep(0.22, 0.88, driftNoise * 0.72 + fineNoise * 0.28);
      float lowMist = 1.0 - smoothstep(0.05, 0.94, uv.y);
      float fog = clamp(wisps * density * (0.58 + lowMist * 0.56), 0.0, 1.0);

      vec3 source = texture(u_tex, uv).rgb;
      float warmZone = smoothstep(0.14, 0.86, uv.y + (fineNoise - 0.5) * 0.24);
      vec3 fogColor = mix(vec3(0.10, 0.25, 0.28), vec3(0.48, 0.36, 0.36), warmZone);
      fogColor += vec3(0.16, 0.16, 0.25) * smoothstep(0.38, 0.92, driftNoise);

      vec3 color = mix(source, fogColor, fog * 0.74);
      float lightShaft = smoothstep(0.52, 0.92, fineNoise) * (1.0 - smoothstep(0.44, 1.0, uv.y));
      color += vec3(0.15, 0.22, 0.19) * lightShaft * density * 0.29;
      color += (fineNoise - 0.5) * density * 0.045;
      out_color = vec4(max(color, 0.0), 1.0);
    }
  `;

  const DOT_FRAGMENT_SHADER = `#version 300 es
    precision highp float;

    uniform sampler2D u_tex;
    uniform vec2 u_res;
    uniform float u_time;
    uniform float u_aspect;
    uniform float u_cell;
    uniform float u_strength;
    uniform float u_contrast;
    out vec4 out_color;

    void main() {
      vec2 uv = gl_FragCoord.xy / u_res;
      vec3 source = texture(u_tex, uv).rgb;
      vec2 pixel = uv * u_res;
      float cellSize = max(2.0, u_cell);
      vec2 cellOrigin = floor(pixel / cellSize) * cellSize;
      vec2 cellCenter = (cellOrigin + vec2(cellSize * 0.5)) / u_res;
      vec3 sampled = texture(u_tex, clamp(cellCenter, vec2(0.001), vec2(0.999))).rgb;

      float luminance = dot(sampled, vec3(0.299, 0.587, 0.114));
      luminance = clamp(pow(luminance, max(0.5, u_contrast)), 0.0, 1.0);
      float radius = cellSize * 0.52 * sqrt(luminance);
      vec2 local = mod(pixel, vec2(cellSize)) - vec2(cellSize * 0.5);
      float distanceToCenter = length(local);
      float edge = max(0.85, cellSize * 0.055);
      float dotMask = 1.0 - smoothstep(radius - edge, radius + edge, distanceToCenter);

      vec3 dotColor = mix(sampled, vec3(0.92, 0.84, 0.63), 0.18);
      dotColor = pow(max(dotColor, 0.0), vec3(0.88)) * (0.88 + luminance * 0.30);
      vec3 background = vec3(0.010, 0.021, 0.023);
      background += vec3(0.010, 0.038, 0.035) * (0.5 + 0.5 * sin(uv.y * 3.0));
      vec3 matrix = mix(background, dotColor, dotMask);

      float gridDistance = min(distanceToCenter, cellSize * 0.5 - distanceToCenter);
      float gridLine = 1.0 - smoothstep(0.0, 0.45, gridDistance);
      matrix += vec3(0.03, 0.065, 0.060) * gridLine * (1.0 - dotMask);

      float mixAmount = clamp(u_strength, 0.0, 1.0);
      vec3 color = mix(source, matrix, mixAmount);
      color += vec3(0.22, 0.21, 0.09) * dotMask * luminance * mixAmount * 0.18;
      out_color = vec4(color, 1.0);
    }
  `;

  const DISPLAY_FRAGMENT_SHADER = `#version 300 es
    precision highp float;

    uniform sampler2D u_tex;
    uniform vec2 u_res;
    uniform float u_time;
    uniform float u_aspect;
    out vec4 out_color;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_res;
      vec3 color = texture(u_tex, uv).rgb;
      color = max(color, 0.0);
      color = color / (color + vec3(0.18)) * 1.18;
      color = pow(color, vec3(0.94));
      float vignette = smoothstep(1.34, 0.39, length((uv - 0.5) * vec2(u_aspect, 1.0)));
      color *= mix(0.82, 1.0, vignette);
      float grain = hash12(gl_FragCoord.xy + fract(u_time)) - 0.5;
      color += grain / 255.0;
      out_color = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `;

  function exposeTestApi() {
    window.__prismLab = Object.freeze({
      freeze(time = 0) {
        setPaused(true, time);
        return renderer?.getStatus() ?? null;
      },
      resume() {
        setPaused(false);
        return renderer?.getStatus() ?? null;
      },
      renderAt(time) {
        if (!renderer) {
          return null;
        }
        renderer.paused = true;
        renderer.pausedAt = Math.max(0, Number(time) || 0);
        renderer.renderAt(renderer.pausedAt);
        return renderer.getStatus();
      },
      captureDataURL() {
        return renderer?.snapshotDataURL() ?? null;
      },
      getState() {
        return {
          chain: serializeChain(),
          selectedIndex: state.chain.findIndex((effect) => effect.id === state.selectedId),
          paused: state.paused,
          stats: renderer?.getStatus() ?? null,
          saved: state.saved.map((entry) => ({
            id: entry.id,
            name: entry.name,
            chain: entry.chain,
          })),
        };
      },
      saveChain(name) {
        dom.saveName.value = String(name ?? "");
        saveCurrentChain();
        return state.saved[0]?.id ?? null;
      },
      loadChain(id) {
        loadSavedChain(id);
        return serializeChain();
      },
    });
  }

  function boot() {
    state.saved = readSavedChains();
    state.chain = createDefaultChain();
    state.selectedId = state.chain[0]?.id ?? null;
    renderSavedChains();
    renderCounts();
    syncPauseButton();

    try {
      renderer = new ShaderRenderer(dom.canvas, {
        onStats: updateFrameStats,
      });
    } catch (error) {
      console.error("Unable to initialize the shader sandbox.", error);
      dom.webglError.hidden = false;
      const message = dom.webglError.querySelector("p");
      if (message) {
        message.textContent = `WebGL 初始化失败：${error.message}`;
      }
    }

    renderAll();
    exposeTestApi();
  }

  boot();
})();
