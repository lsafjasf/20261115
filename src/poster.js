(() => {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const XLINK_NS = "http://www.w3.org/1999/xlink";
  const WIDTH = 900;
  const HEIGHT = 1200;
  const FONT_STACK = "'Poster Sans', 'Noto Sans SC Local', 'Noto Sans SC', 'PingFang SC', sans-serif";
  const SAFE_ZONE = Object.freeze({ x: 312, y: 286, width: 276, height: 374 });
  const SAFE_PADDING = 18;
  const CANVAS_PADDING = 18;
  const STORAGE_KEY = "discount-poster-editor-v2";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const el = (tag, attrs = {}, text = "") => {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    });
    if (text) node.textContent = text;
    return node;
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const round = (value, precision = 1) => {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  };

  const escapeXml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  const makeBurstPoints = (cx, cy, points, outer, inner) => {
    const result = [];
    for (let index = 0; index < points * 2; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / points;
      const radius = index % 2 === 0 ? outer : inner;
      result.push(`${round(cx + Math.cos(angle) * radius, 2)},${round(cy + Math.sin(angle) * radius, 2)}`);
    }
    return result.join(" ");
  };

  const STICKERS = {
    burst: {
      name: "促销爆炸",
      markup: `<polygon points="${makeBurstPoints(60, 60, 16, 58, 40)}" fill="#ffd166"/>
        <circle cx="60" cy="60" r="24" fill="#ffb84d"/>`,
    },
    percent: {
      name: "折扣百分号",
      markup: `<circle cx="60" cy="60" r="51" fill="#ffd166"/>
        <path d="M38 34 L82 86" fill="none" stroke="#8d1d23" stroke-width="11" stroke-linecap="round"/>
        <circle cx="37" cy="78" r="11" fill="none" stroke="#8d1d23" stroke-width="9"/>
        <circle cx="83" cy="42" r="11" fill="none" stroke="#8d1d23" stroke-width="9"/>`,
    },
    gift: {
      name: "礼物盒",
      markup: `<rect x="16" y="43" width="88" height="61" rx="6" fill="#ffd166"/>
        <rect x="11" y="24" width="98" height="24" rx="5" fill="#ffdc82"/>
        <rect x="53" y="24" width="14" height="80" fill="#ff8c52"/>
        <path d="M60 25 C44 4 25 10 32 24 M60 25 C76 4 95 10 88 24"
          fill="none" stroke="#ff8c52" stroke-width="8" stroke-linecap="round"/>`,
    },
    star: {
      name: "闪耀星",
      markup: `<polygon points="60,7 74,42 112,44 82,68 92,105 60,84 28,105 38,68 8,44 46,42"
        fill="#ffd166"/>`,
    },
    heart: {
      name: "爱心",
      markup: `<path d="M60 106 C21 78 7 57 7 36 C7 18 21 8 36 8 C47 8 55 14 60 24
        C65 14 73 8 84 8 C99 8 113 18 113 36 C113 57 99 78 60 106 Z" fill="#ff8a72"/>`,
    },
    coupon: {
      name: "优惠券",
      markup: `<path d="M7 17 H113 L99 38 L113 60 L99 82 H7 L21 60 L7 38 Z" fill="#ff9c5b"/>
        <line x1="83" y1="20" x2="83" y2="79" fill="none" stroke="#8d1d23"
          stroke-width="4" stroke-dasharray="7 6"/>`,
    },
    arrow: {
      name: "抢购箭头",
      markup: `<rect x="46" y="8" width="22" height="58" rx="7" fill="#ffd166"/>
        <path d="M19 62 L60 106 L101 62 Z" fill="#ffd166"/>`,
    },
    sparkle: {
      name: "四角闪光",
      markup: `<path d="M60 4 C67 38 82 53 116 60 C82 67 67 82 60 116 C53 82 38 67 4 60
        C38 53 53 38 60 4 Z" fill="#fff1b8"/>`,
    },
    tag: {
      name: "价格吊牌",
      markup: `<path d="M21 11 H91 L110 33 L91 55 H21 C10 55 4 47 4 33 C4 19 10 11 21 11 Z"
          fill="#ffd166"/>
        <circle cx="21" cy="33" r="8" fill="none" stroke="#8d1d23" stroke-width="5"/>`,
    },
    bolt: {
      name: "限时闪电",
      markup: `<path d="M68 5 L21 67 H54 L43 115 L101 47 H67 Z" fill="#ffd166"/>`,
    },
  };

  const BASE_ITEMS = [
    {
      id: "sticker-gift-left",
      type: "sticker",
      sticker: "gift",
      name: "左下礼物",
      x: 111,
      y: 1009,
      width: 126,
      height: 126,
      rotation: -9,
      color: "#fff1b8",
      shadow: { enabled: true, blur: 9, dx: 4, dy: 7, opacity: 0.34, color: "#2e0306" },
      stroke: { width: 2, color: "#7e171b" },
    },
    {
      id: "sticker-heart-right",
      type: "sticker",
      sticker: "heart",
      name: "右下爱心",
      x: 789,
      y: 1006,
      width: 100,
      height: 100,
      rotation: 11,
      color: "#ffe7ad",
      shadow: { enabled: true, blur: 8, dx: 3, dy: 5, opacity: 0.3, color: "#2e0306" },
      stroke: { width: 1.5, color: "#8d1d23" },
    },
    {
      id: "sticker-coupon-left",
      type: "sticker",
      sticker: "coupon",
      name: "左侧优惠券",
      x: 53,
      y: 759,
      width: 154,
      height: 96,
      rotation: -10,
      color: "#ffd166",
      shadow: { enabled: true, blur: 8, dx: 4, dy: 6, opacity: 0.28, color: "#2e0306" },
      stroke: { width: 2, color: "#822027" },
    },
    {
      id: "sticker-star-left",
      type: "sticker",
      sticker: "star",
      name: "左侧星标",
      x: 104,
      y: 354,
      width: 76,
      height: 76,
      rotation: 14,
      color: "#ffe7ad",
      shadow: { enabled: true, blur: 6, dx: 3, dy: 4, opacity: 0.25, color: "#2e0306" },
      stroke: { width: 1.5, color: "#8d1d23" },
    },
    {
      id: "sticker-star-right",
      type: "sticker",
      sticker: "sparkle",
      name: "右上闪光",
      x: 792,
      y: 329,
      width: 67,
      height: 67,
      rotation: -4,
      color: "#fff1b8",
      shadow: { enabled: true, blur: 8, dx: 2, dy: 5, opacity: 0.24, color: "#2e0306" },
      stroke: { width: 0, color: "#8d1d23" },
    },
    {
      id: "sticker-burst-hero",
      type: "sticker",
      sticker: "burst",
      name: "中央爆炸贴",
      x: 451,
      y: 441,
      width: 326,
      height: 326,
      rotation: -5,
      color: "#ffefba",
      shadow: { enabled: true, blur: 17, dx: 7, dy: 11, opacity: 0.42, color: "#2b0205" },
      stroke: { width: 3, color: "#7a151b" },
    },
    {
      id: "sticker-percent-hero",
      type: "sticker",
      sticker: "percent",
      name: "中央折扣符号",
      x: 547,
      y: 563,
      width: 160,
      height: 160,
      rotation: -13,
      color: "#ffefba",
      shadow: { enabled: true, blur: 13, dx: 5, dy: 9, opacity: 0.38, color: "#2b0205" },
      stroke: { width: 2.5, color: "#7a151b" },
    },
    {
      id: "sticker-arrow-right",
      type: "sticker",
      sticker: "arrow",
      name: "右侧箭头",
      x: 697,
      y: 673,
      width: 92,
      height: 92,
      rotation: 176,
      color: "#ffe7ad",
      shadow: { enabled: true, blur: 9, dx: 3, dy: 6, opacity: 0.27, color: "#2e0306" },
      stroke: { width: 1.5, color: "#8d1d23" },
    },
    {
      id: "title-main",
      type: "title",
      name: "主标题",
      x: 450,
      y: 151,
      text: "双11 超级折扣季",
      fontSize: 68,
      fontWeight: 900,
      rotation: 0,
      fill: "#ffe4a0",
      color: "#ffe4a0",
      shadow: { enabled: true, blur: 9, dx: 4, dy: 7, opacity: 0.34, color: "#42080c" },
      stroke: { width: 3.5, color: "#7c171e" },
    },
    {
      id: "title-sub",
      type: "title",
      name: "副标题",
      x: 450,
      y: 236,
      text: "全场好物 · 限时开抢",
      fontSize: 33,
      fontWeight: 700,
      rotation: 0,
      fill: "#fff8e8",
      color: "#fff8e8",
      shadow: { enabled: true, blur: 7, dx: 2, dy: 5, opacity: 0.27, color: "#42080c" },
      stroke: { width: 0.8, color: "#842025" },
    },
    {
      id: "price-main",
      type: "price",
      name: "主价格",
      x: 450,
      y: 829,
      text: "全场 5 折起",
      fontSize: 59,
      fontWeight: 900,
      rotation: 0,
      fill: "#ffd166",
      color: "#ffd166",
      shadow: { enabled: true, blur: 11, dx: 4, dy: 8, opacity: 0.36, color: "#380609" },
      stroke: { width: 2.5, color: "#79161c" },
    },
    {
      id: "price-detail",
      type: "price",
      name: "到手价",
      x: 450,
      y: 916,
      text: "到手价 ¥199 起",
      fontSize: 45,
      fontWeight: 900,
      rotation: 0,
      fill: "#fff4d5",
      color: "#fff4d5",
      shadow: { enabled: true, blur: 9, dx: 3, dy: 6, opacity: 0.32, color: "#380609" },
      stroke: { width: 1.6, color: "#7f1a20" },
    },
    {
      id: "price-note",
      type: "price",
      name: "叠加优惠",
      x: 450,
      y: 988,
      text: "叠加满 300 减 50",
      fontSize: 29,
      fontWeight: 700,
      rotation: 0,
      fill: "#ffe9af",
      color: "#ffe9af",
      shadow: { enabled: false, blur: 6, dx: 2, dy: 4, opacity: 0.25, color: "#380609" },
      stroke: { width: 0.6, color: "#7f1a20" },
    },
  ];

  const state = {
    items: [],
    selectedId: null,
    showSafeZone: true,
    drag: null,
    fontReady: false,
    exporting: false,
    baseFonts: {},
  };

  const dom = {
    svg: $("#posterSvg"),
    defs: $("#posterDefs"),
    background: $("#backgroundLayer"),
    elements: $("#elementLayer"),
    editor: $("#editorLayer"),
    stickerGrid: $("#stickerGrid"),
    layerList: $("#layerList"),
    emptyState: $("#emptyState"),
    inspector: $("#inspectorContent"),
    typeBadge: $("#typeBadge"),
    toast: $("#toast"),
  };

  const textContext = document.createElement("canvas").getContext("2d");

  function fontSizeFor(item) {
    return item.fontSize || 40;
  }

  function itemBounds(item) {
    if (item.type === "sticker") {
      return { width: item.width, height: item.height };
    }
    const fontSize = fontSizeFor(item);
    textContext.font = `${item.fontWeight || 700} ${fontSize}px ${FONT_STACK}`;
    const measured = textContext.measureText(item.text || "");
    return {
      width: Math.max(80, measured.width + fontSize * 0.32),
      height: fontSize * 1.24,
    };
  }

  function itemTransform(item) {
    return `translate(${round(item.x, 2)} ${round(item.y, 2)}) rotate(${round(item.rotation || 0, 2)})`;
  }

  function buildDefs() {
    const symbols = Object.entries(STICKERS).map(([key, sticker]) => (
      `<symbol id="sticker-${key}" viewBox="0 0 120 120">${sticker.markup}</symbol>`
    )).join("");
    const filters = state.items.filter((item) => item.shadow?.enabled).map((item) => {
      const shadow = item.shadow;
      return `<filter id="shadow-${item.id}" x="-60%" y="-60%" width="220%" height="220%"
        color-interpolation-filters="sRGB">
        <feDropShadow dx="${shadow.dx}" dy="${shadow.dy}" stdDeviation="${shadow.blur / 2}"
          flood-color="${shadow.color}" flood-opacity="${shadow.opacity}"/>
      </filter>`;
    }).join("");
    dom.defs.innerHTML = `
      <linearGradient id="poster-bg" x1="0" y1="0" x2="0.12" y2="1">
        <stop offset="0" stop-color="#ce2630"/>
        <stop offset="0.48" stop-color="#ab1722"/>
        <stop offset="1" stop-color="#741018"/>
      </linearGradient>
      <radialGradient id="poster-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#ffbc63" stop-opacity="0.34"/>
        <stop offset="1" stop-color="#ffbc63" stop-opacity="0"/>
      </radialGradient>
      <pattern id="poster-dots" width="34" height="34" patternUnits="userSpaceOnUse">
        <circle cx="4" cy="4" r="1.4" fill="#ffe3b1" opacity="0.14"/>
      </pattern>
      ${symbols}
      ${filters}
    `;
  }

  function renderBackground() {
    dom.background.innerHTML = `
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#poster-bg)"/>
      <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#poster-dots)" opacity="0.62"/>
      <circle cx="817" cy="109" r="196" fill="#ff8e58" opacity="0.16"/>
      <circle cx="816" cy="109" r="126" fill="#ffb66f" opacity="0.1"/>
      <circle cx="70" cy="1078" r="210" fill="url(#poster-glow)" opacity="0.58"/>
      <circle cx="819" cy="1051" r="156" fill="#ff8766" opacity="0.12"/>
      <circle cx="451" cy="443" r="230" fill="url(#poster-glow)" opacity="0.3"/>
      <path d="M-80 690 C120 586 215 610 323 714 S590 846 979 692"
        fill="none" stroke="#ffd9a0" stroke-width="1.4" opacity="0.12"/>
      <path d="M-30 734 C147 639 235 657 347 752 S596 875 938 750"
        fill="none" stroke="#ffd9a0" stroke-width="1" opacity="0.08"/>
      <path d="M750 0 L900 0 L900 184 C845 145 803 94 750 0 Z" fill="#ffe1a3" opacity="0.055"/>
      <rect x="22" y="22" width="856" height="1156" rx="3" fill="none"
        stroke="#ffe7b3" stroke-width="1.2" opacity="0.18"/>
      <rect x="0" y="1105" width="900" height="95" fill="#5f0c12" opacity="0.58"/>
      <line x1="124" y1="1105" x2="776" y2="1105" stroke="#ffdfaa" stroke-width="1" opacity="0.16"/>
      <text x="450" y="1163" text-anchor="middle" font-family="${FONT_STACK}"
        font-size="28" font-weight="400" fill="#ffe8c8" letter-spacing="1.2">
        活动时间：11 月 1 日 — 11 月 15 日 · 全场包邮
      </text>
      <text x="83" y="1116" font-family="${FONT_STACK}" font-size="10" font-weight="700"
        fill="#ffd8a3" opacity="0.66" letter-spacing="3">11.11 LIMITED OFFER</text>
      <text x="817" y="1116" text-anchor="end" font-family="${FONT_STACK}" font-size="10"
        font-weight="700" fill="#ffd8a3" opacity="0.66" letter-spacing="2">NO. 1111</text>
    `;
  }

  function createStickerNode(item) {
    const group = el("g", {
      class: `poster-element sticker-element${state.selectedId === item.id ? " is-selected" : ""}`,
      "data-id": item.id,
      "data-type": item.type,
      transform: itemTransform(item),
      filter: item.shadow?.enabled ? `url(#shadow-${item.id})` : null,
    });
    const use = el("use", {
      href: `#sticker-${item.sticker}`,
      x: -item.width / 2,
      y: -item.height / 2,
      width: item.width,
      height: item.height,
      stroke: item.stroke?.width > 0 ? item.stroke.color : "none",
      "stroke-width": item.stroke?.width || 0,
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
    });
    use.setAttributeNS(XLINK_NS, "xlink:href", `#sticker-${item.sticker}`);
    group.append(use);
    return group;
  }

  function createTextNode(item) {
    const group = el("g", {
      class: `poster-element text-element${state.selectedId === item.id ? " is-selected" : ""}`,
      "data-id": item.id,
      "data-type": item.type,
      transform: itemTransform(item),
      filter: item.shadow?.enabled ? `url(#shadow-${item.id})` : null,
    });
    const text = el("text", {
      x: 0,
      y: 0,
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "font-family": FONT_STACK,
      "font-size": fontSizeFor(item),
      "font-weight": item.fontWeight || 700,
      fill: item.fill || item.color || "#ffffff",
      stroke: item.stroke?.width > 0 ? item.stroke.color : "none",
      "stroke-width": item.stroke?.width || 0,
      "stroke-linejoin": "round",
      "paint-order": "stroke fill",
      "letter-spacing": item.type === "title" ? "1.5" : "0.5",
    }, item.text);
    group.append(text);
    return group;
  }

  function renderElements() {
    dom.elements.replaceChildren();
    state.items.forEach((item) => {
      const node = item.type === "sticker" ? createStickerNode(item) : createTextNode(item);
      dom.elements.append(node);
    });
  }

  function renderEditorLayer() {
    dom.editor.replaceChildren();
    dom.editor.dataset.editorUi = "true";
    dom.editor.classList.toggle("is-hidden", !state.showSafeZone && !state.selectedId);

    if (state.showSafeZone) {
      const safeGroup = el("g", { class: "safe-zone-group" });
      safeGroup.append(
        el("rect", {
          class: "safe-zone",
          x: SAFE_ZONE.x,
          y: SAFE_ZONE.y,
          width: SAFE_ZONE.width,
          height: SAFE_ZONE.height,
          rx: 8,
        }),
        el("text", {
          class: "safe-zone-label",
          x: SAFE_ZONE.x + SAFE_ZONE.width / 2,
          y: SAFE_ZONE.y + SAFE_ZONE.height - 18,
        }, "关键视觉中心 · 文字禁止遮挡"),
      );
      dom.editor.append(safeGroup);
    }

    const selected = getSelected();
    if (!selected) return;
    const bounds = itemBounds(selected);
    const outline = el("g", {
      transform: itemTransform(selected),
      "data-selection-for": selected.id,
    });
    outline.append(
      el("rect", {
        class: "selection-outline",
        x: -bounds.width / 2,
        y: -bounds.height / 2,
        width: bounds.width,
        height: bounds.height,
        rx: 5,
      }),
      el("line", {
        x1: 0,
        y1: -bounds.height / 2,
        x2: 0,
        y2: -bounds.height / 2 - 23,
        stroke: "#ffd166",
        "stroke-width": 1.5,
        "vector-effect": "non-scaling-stroke",
      }),
      el("circle", {
        class: "selection-handle rotate-handle",
        cx: 0,
        cy: -bounds.height / 2 - 29,
        r: 6,
        "data-rotate-handle": selected.id,
      }),
    );
    dom.editor.append(outline);
  }

  function getSelected() {
    return state.items.find((item) => item.id === state.selectedId) || null;
  }

  function overlapsSafeZone(x, y, bounds) {
    const left = x - bounds.width / 2;
    const right = x + bounds.width / 2;
    const top = y - bounds.height / 2;
    const bottom = y + bounds.height / 2;
    return !(
      right < SAFE_ZONE.x
      || left > SAFE_ZONE.x + SAFE_ZONE.width
      || bottom < SAFE_ZONE.y
      || top > SAFE_ZONE.y + SAFE_ZONE.height
    );
  }

  function clampToCanvas(item, x, y) {
    const bounds = itemBounds(item);
    const minX = Math.min(WIDTH / 2, bounds.width / 2 + CANVAS_PADDING);
    const maxX = Math.max(WIDTH / 2, WIDTH - bounds.width / 2 - CANVAS_PADDING);
    const minY = Math.min(HEIGHT / 2, bounds.height / 2 + CANVAS_PADDING);
    const maxY = Math.max(HEIGHT / 2, HEIGHT - bounds.height / 2 - CANVAS_PADDING);
    return {
      x: clamp(x, minX, maxX),
      y: clamp(y, minY, maxY),
    };
  }

  function avoidCriticalCenter(item, proposedX, proposedY) {
    const bounded = clampToCanvas(item, proposedX, proposedY);
    if (item.type === "sticker") return bounded;

    const bounds = itemBounds(item);
    if (!overlapsSafeZone(bounded.x, bounded.y, bounds)) return bounded;

    const candidates = [
      { x: bounded.x, y: SAFE_ZONE.y - SAFE_PADDING - bounds.height / 2 },
      { x: bounded.x, y: SAFE_ZONE.y + SAFE_ZONE.height + SAFE_PADDING + bounds.height / 2 },
      { x: SAFE_ZONE.x - SAFE_PADDING - bounds.width / 2, y: bounded.y },
      { x: SAFE_ZONE.x + SAFE_ZONE.width + SAFE_PADDING + bounds.width / 2, y: bounded.y },
    ].map((point) => clampToCanvas(item, point.x, point.y));

    const valid = candidates.filter((point) => !overlapsSafeZone(point.x, point.y, bounds));
    if (!valid.length) return bounded;
    valid.sort((a, b) => (
      Math.hypot(a.x - proposedX, a.y - proposedY)
      - Math.hypot(b.x - proposedX, b.y - proposedY)
    ));
    return valid[0];
  }

  function refreshCanvas() {
    buildDefs();
    renderElements();
    renderEditorLayer();
  }

  function renderStickerLibrary() {
    dom.stickerGrid.innerHTML = Object.entries(STICKERS).map(([key, sticker]) => `
      <button class="sticker-card" type="button" data-sticker="${key}" title="添加${sticker.name}">
        <svg viewBox="0 0 120 120" aria-hidden="true">${sticker.markup}</svg>
        <span>${sticker.name}</span>
      </button>
    `).join("");
    $("#stickerCount").textContent = String(Object.keys(STICKERS).length);
  }

  function renderLayerList() {
    const ordered = [...state.items].reverse();
    dom.layerList.innerHTML = ordered.map((item, visibleIndex) => {
      const typeLetter = item.type === "sticker" ? "贴" : item.type === "title" ? "题" : "价";
      const zIndex = state.items.length - visibleIndex;
      return `
        <button class="layer-item${item.id === state.selectedId ? " active" : ""}"
          type="button" data-layer-id="${item.id}" title="${escapeXml(item.name || item.text || "元素")}">
          <span class="layer-icon">${typeLetter}</span>
          <span class="layer-name">${escapeXml(item.name || item.text || "元素")}</span>
          <span class="layer-index">Z${zIndex}</span>
        </button>
      `;
    }).join("");
  }

  function setValue(id, value) {
    const field = $(`#${id}`);
    if (field && document.activeElement !== field) field.value = value;
  }

  function updateInspector() {
    const item = getSelected();
    dom.emptyState.hidden = Boolean(item);
    dom.inspector.hidden = !item;
    if (!item) {
      dom.typeBadge.textContent = "未选择";
      $("#selectionLabel").textContent = "未选择元素";
      return;
    }

    const typeName = item.type === "sticker" ? "矢量贴纸" : item.type === "title" ? "标题文字" : "价格标签";
    dom.typeBadge.textContent = typeName;
    $("#selectionLabel").textContent = `${item.name} · 可拖动`;
    const isText = item.type !== "sticker";
    $("#textFieldWrap").hidden = !isText;
    $("#textContentLabel").hidden = !isText;
    $("#textSection").hidden = !isText;

    setValue("textContent", item.text || "");
    $("#charCount").textContent = `${(item.text || "").length} / 40`;
    setValue("posX", Math.round(item.x));
    setValue("posY", Math.round(item.y));
    setValue("fontSize", fontSizeFor(item));
    $("#fontSizeOut").textContent = String(fontSizeFor(item));
    setValue("textFill", item.fill || item.color || "#ffffff");
    setValue("rotation", item.rotation || 0);
    $("#rotationOut").textContent = `${Math.round(item.rotation || 0)}°`;
    $("#shadowEnabled").checked = Boolean(item.shadow?.enabled);
    setValue("shadowBlur", item.shadow?.blur ?? 10);
    $("#shadowBlurOut").textContent = String(item.shadow?.blur ?? 10);
    setValue("shadowOpacity", item.shadow?.opacity ?? 0.35);
    $("#shadowOpacityOut").textContent = Number(item.shadow?.opacity ?? 0.35).toFixed(2);
    setValue("shadowX", item.shadow?.dx ?? 4);
    setValue("shadowY", item.shadow?.dy ?? 6);
    setValue("shadowColor", item.shadow?.color ?? "#000000");
    setValue("strokeWidth", item.stroke?.width ?? 0);
    $("#strokeWidthOut").textContent = String(item.stroke?.width ?? 0);
    setValue("strokeColor", item.stroke?.color ?? "#7a151b");
    $("#shadowFields").classList.toggle("is-disabled", !item.shadow?.enabled);
    const index = state.items.findIndex((candidate) => candidate.id === item.id);
    $("#layerPosition").textContent = `第 ${index + 1} 层 / 共 ${state.items.length} 层`;
  }

  function renderLayerPositionOnly() {
    updateInspector();
  }

  function refreshAll() {
    refreshCanvas();
    renderLayerList();
    updateInspector();
    saveState();
  }

  function selectItem(id) {
    state.selectedId = id;
    refreshCanvas();
    renderLayerList();
    updateInspector();
  }

  function addSticker(stickerKey) {
    const sticker = STICKERS[stickerKey];
    if (!sticker) return;
    const baseX = 178 + ((state.items.length * 137) % 548);
    const baseY = 573 + ((state.items.length * 83) % 232);
    const item = {
      id: `sticker-${stickerKey}-${Date.now().toString(36)}`,
      type: "sticker",
      sticker: stickerKey,
      name: sticker.name,
      x: baseX,
      y: baseY,
      width: 112,
      height: 112,
      rotation: (state.items.length % 5) * 4 - 8,
      color: "#ffe7ad",
      shadow: { enabled: true, blur: 9, dx: 4, dy: 6, opacity: 0.32, color: "#2e0306" },
      stroke: { width: 1.5, color: "#821f24" },
    };
    state.items.push(item);
    selectItem(item.id);
    showToast(`已添加${sticker.name} · 纯矢量`);
  }

  function reorderSelected(action) {
    const item = getSelected();
    if (!item) return;
    const index = state.items.indexOf(item);
    let target = index;
    if (action === "front") target = state.items.length - 1;
    if (action === "back") target = 0;
    if (action === "forward") target = Math.min(state.items.length - 1, index + 1);
    if (action === "backward") target = Math.max(0, index - 1);
    if (target === index) {
      showToast(target === state.items.length - 1 && action === "forward" ? "已经是顶层" : "已经是底层");
      return;
    }
    state.items.splice(index, 1);
    state.items.splice(target, 0, item);
    refreshAll();
    showToast(`层级已调整 · 当前第 ${target + 1} 层`);
  }

  function deleteSelected() {
    const item = getSelected();
    if (!item) return;
    state.items = state.items.filter((candidate) => candidate.id !== item.id);
    state.selectedId = null;
    refreshAll();
    showToast(`已删除${item.name}`);
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        items: state.items,
        selectedId: state.selectedId,
        showSafeZone: state.showSafeZone,
      }));
    } catch (error) {
      console.warn("无法保存编辑器状态", error);
    }
  }

  function cloneBaseItems() {
    return JSON.parse(JSON.stringify(BASE_ITEMS));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (saved?.version !== 2 || !Array.isArray(saved.items) || !saved.items.length) return null;
      const items = saved.items.filter((item) => (
        item
        && ["sticker", "title", "price"].includes(item.type)
        && Number.isFinite(item.x)
        && Number.isFinite(item.y)
        && (item.type === "sticker" ? STICKERS[item.sticker] : typeof item.text === "string")
      ));
      if (!items.length) return null;
      return {
        items,
        selectedId: items.some((item) => item.id === saved.selectedId) ? saved.selectedId : null,
        showSafeZone: saved.showSafeZone !== false,
      };
    } catch (error) {
      console.warn("无法恢复编辑器状态", error);
      return null;
    }
  }

  let toastTimer = 0;
  function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => dom.toast.classList.remove("is-visible"), 1900);
  }

  function svgPoint(event) {
    const point = dom.svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(dom.svg.getScreenCTM().inverse());
  }

  function beginPointerInteraction(event) {
    if (event.button !== 0 || state.exporting) return;
    const rotateHandle = event.target.closest?.("[data-rotate-handle]");
    if (rotateHandle) {
      const item = getSelected();
      if (!item) return;
      const point = svgPoint(event);
      state.drag = {
        mode: "rotate",
        id: item.id,
        pointerId: event.pointerId,
        startRotation: item.rotation || 0,
        startAngle: Math.atan2(point.y - item.y, point.x - item.x) * 180 / Math.PI,
      };
      dom.svg.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    const node = event.target.closest?.(".poster-element[data-id]");
    if (!node) {
      selectItem(null);
      return;
    }
    const item = state.items.find((candidate) => candidate.id === node.dataset.id);
    if (!item) return;
    if (state.selectedId !== item.id) selectItem(item.id);
    const point = svgPoint(event);
    state.drag = {
      mode: "move",
      id: item.id,
      pointerId: event.pointerId,
      offsetX: point.x - item.x,
      offsetY: point.y - item.y,
    };
    dom.svg.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function movePointerInteraction(event) {
    if (!state.drag || state.drag.pointerId !== event.pointerId) return;
    const item = state.items.find((candidate) => candidate.id === state.drag.id);
    if (!item) return;
    const point = svgPoint(event);

    if (state.drag.mode === "rotate") {
      const angle = Math.atan2(point.y - item.y, point.x - item.x) * 180 / Math.PI;
      item.rotation = round(state.drag.startRotation + angle - state.drag.startAngle, 1);
    } else {
      const proposedX = point.x - state.drag.offsetX;
      const proposedY = point.y - state.drag.offsetY;
      const safe = avoidCriticalCenter(item, proposedX, proposedY);
      item.x = round(safe.x);
      item.y = round(safe.y);
    }

    refreshCanvas();
    renderLayerPositionOnly();
  }

  function endPointerInteraction(event) {
    if (!state.drag) return;
    const drag = state.drag;
    state.drag = null;
    if (dom.svg.hasPointerCapture?.(drag.pointerId)) {
      dom.svg.releasePointerCapture(drag.pointerId);
    }
    saveState();
    if (event.type === "pointercancel") refreshAll();
  }

  function bindInspectorEvents() {
    $("#textContent").addEventListener("input", (event) => {
      const item = getSelected();
      if (!item || item.type === "sticker") return;
      item.text = event.target.value.slice(0, 40);
      $("#charCount").textContent = `${item.text.length} / 40`;
      const safe = avoidCriticalCenter(item, item.x, item.y);
      item.x = safe.x;
      item.y = safe.y;
      refreshCanvas();
      renderLayerList();
    });

    $("#textContent").addEventListener("change", () => saveState());
    $("#fontSize").addEventListener("input", (event) => {
      const item = getSelected();
      if (!item || item.type === "sticker") return;
      item.fontSize = Number(event.target.value);
      $("#fontSizeOut").textContent = event.target.value;
      const safe = avoidCriticalCenter(item, item.x, item.y);
      item.x = safe.x;
      item.y = safe.y;
      refreshCanvas();
      renderLayerPositionOnly();
    });
    $("#fontSize").addEventListener("change", () => saveState());

    ["textFill", "strokeColor", "shadowColor"].forEach((id) => {
      $(`#${id}`).addEventListener("input", (event) => {
        const item = getSelected();
        if (!item) return;
        if (id === "textFill") item.fill = item.color = event.target.value;
        if (id === "strokeColor") item.stroke.color = event.target.value;
        if (id === "shadowColor") item.shadow.color = event.target.value;
        refreshCanvas();
      });
      $(`#${id}`).addEventListener("change", () => saveState());
    });

    $("#rotation").addEventListener("input", (event) => {
      const item = getSelected();
      if (!item) return;
      item.rotation = Number(event.target.value);
      $("#rotationOut").textContent = `${event.target.value}°`;
      refreshCanvas();
    });
    $("#rotation").addEventListener("change", () => saveState());

    const directShadows = {
      shadowBlur: (item, value) => { item.shadow.blur = Number(value); },
      shadowOpacity: (item, value) => { item.shadow.opacity = Number(value); },
      shadowX: (item, value) => { item.shadow.dx = Number(value); },
      shadowY: (item, value) => { item.shadow.dy = Number(value); },
    };
    Object.entries(directShadows).forEach(([id, apply]) => {
      $(`#${id}`).addEventListener("input", (event) => {
        const item = getSelected();
        if (!item) return;
        apply(item, event.target.value);
        if (id === "shadowBlur") $("#shadowBlurOut").textContent = event.target.value;
        if (id === "shadowOpacity") $("#shadowOpacityOut").textContent = Number(event.target.value).toFixed(2);
        refreshCanvas();
      });
      $(`#${id}`).addEventListener("change", () => saveState());
    });

    $("#shadowEnabled").addEventListener("change", (event) => {
      const item = getSelected();
      if (!item) return;
      item.shadow.enabled = event.target.checked;
      $("#shadowFields").classList.toggle("is-disabled", !item.shadow.enabled);
      refreshCanvas();
      saveState();
    });

    $("#strokeWidth").addEventListener("input", (event) => {
      const item = getSelected();
      if (!item) return;
      item.stroke.width = Number(event.target.value);
      $("#strokeWidthOut").textContent = event.target.value;
      refreshCanvas();
    });
    $("#strokeWidth").addEventListener("change", () => saveState());

    [["posX", "x"], ["posY", "y"]].forEach(([id, property]) => {
      $(`#${id}`).addEventListener("change", (event) => {
        const item = getSelected();
        if (!item) return;
        const safe = avoidCriticalCenter(
          item,
          property === "x" ? Number(event.target.value) : item.x,
          property === "y" ? Number(event.target.value) : item.y,
        );
        item.x = round(safe.x);
        item.y = round(safe.y);
        refreshAll();
      });
    });
  }

  function bindUiEvents() {
    dom.stickerGrid.addEventListener("click", (event) => {
      const card = event.target.closest("[data-sticker]");
      if (card) addSticker(card.dataset.sticker);
    });

    dom.layerList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-layer-id]");
      if (button) selectItem(button.dataset.layerId);
    });

    $$("[data-layer-action]").forEach((button) => {
      button.addEventListener("click", () => reorderSelected(button.dataset.layerAction));
    });
    $("#deleteElement").addEventListener("click", deleteSelected);
    bindInspectorEvents();

    $("#toggleSafeZone").addEventListener("click", (event) => {
      state.showSafeZone = !state.showSafeZone;
      event.currentTarget.setAttribute("aria-pressed", String(state.showSafeZone));
      renderEditorLayer();
      saveState();
    });

    dom.svg.addEventListener("pointerdown", beginPointerInteraction);
    dom.svg.addEventListener("pointermove", movePointerInteraction);
    dom.svg.addEventListener("pointerup", endPointerInteraction);
    dom.svg.addEventListener("pointercancel", endPointerInteraction);
    dom.svg.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  const FONT_FILES = {
    400: "assets/fonts/noto-sans-sc-400.woff2",
    700: "assets/fonts/noto-sans-sc-700.woff2",
    900: "assets/fonts/noto-sans-sc-900.woff2",
  };

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunks = [];
    const chunkSize = 0x7000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
    }
    return btoa(chunks.join(""));
  }

  async function loadEmbeddedFonts() {
    if (Object.keys(state.baseFonts).length === Object.keys(FONT_FILES).length) {
      return state.baseFonts;
    }
    const entries = await Promise.all(Object.entries(FONT_FILES).map(async ([weight, path]) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`字体加载失败：${path}`);
      const buffer = await response.arrayBuffer();
      return [weight, arrayBufferToBase64(buffer)];
    }));
    state.baseFonts = Object.fromEntries(entries);
    return state.baseFonts;
  }

  function embeddedFontStyle(fonts) {
    const faces = Object.entries(fonts).map(([weight, base64]) => `
      @font-face {
        font-family: "Poster Sans";
        src: url("data:font/woff2;base64,${base64}") format("woff2");
        font-style: normal;
        font-weight: ${weight};
        font-display: block;
      }
    `).join("");
    return `<style>${faces}</style>`;
  }

  async function serializePoster() {
    const fonts = await loadEmbeddedFonts();
    const clone = dom.svg.cloneNode(true);
    clone.querySelector("#editorLayer")?.remove();
    $$(".poster-element.is-selected", clone).forEach((node) => node.classList.remove("is-selected"));
    clone.setAttribute("width", String(WIDTH));
    clone.setAttribute("height", String(HEIGHT));
    clone.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("aria-label", "双11 折扣海报，900 乘 1200 像素");

    const title = el("title", {}, "双11 超级折扣季");
    const description = el("desc", {}, "纯矢量折扣海报。所有文字均为可编辑 SVG text 元素，不含位图素材。");
    clone.prepend(title, description);
    const style = el("style", {}, embeddedFontStyle(fonts));
    clone.querySelector("#posterDefs")?.after(style);

    const source = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
    return `${source}\n`;
  }

  function svgToPngBlob(svgMarkup) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      const url = URL.createObjectURL(new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" }));
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = WIDTH;
          canvas.height = HEIGHT;
          const context = canvas.getContext("2d");
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(image, 0, 0, WIDTH, HEIGHT);
          URL.revokeObjectURL(url);
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("PNG 编码失败"));
          }, "image/png");
        } catch (error) {
          URL.revokeObjectURL(url);
          reject(error);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("SVG 渲染失败，无法生成 PNG"));
      };
      image.src = url;
    });
  }

  async function createExportArtifacts() {
    const svgText = await serializePoster();
    const pngBlob = await svgToPngBlob(svgText);
    return { svgText, pngBlob };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function setExporting(value, label) {
    state.exporting = value;
    ["exportPng", "exportSvg", "exportBoth"].forEach((id) => {
      const button = $(`#${id}`);
      button.disabled = value;
      if (id === "exportBoth") {
        const textNode = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (textNode) textNode.textContent = value ? ` ${label}` : " 同时导出 PNG + SVG";
      }
    });
  }

  async function exportPngOnly() {
    if (state.exporting) return;
    setExporting(true, "正在生成 PNG…");
    try {
      const svgText = await serializePoster();
      const pngBlob = await svgToPngBlob(svgText);
      downloadBlob(pngBlob, "discount-poster.png");
      showToast("PNG 已导出 · 900 × 1200");
    } catch (error) {
      console.error(error);
      showToast("PNG 导出失败");
    } finally {
      setExporting(false);
    }
  }

  async function exportSvgOnly() {
    if (state.exporting) return;
    setExporting(true, "正在生成 SVG…");
    try {
      const svgText = await serializePoster();
      downloadBlob(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }), "discount-poster.svg");
      showToast("SVG 已导出 · 文字仍可编辑");
    } catch (error) {
      console.error(error);
      showToast("SVG 导出失败");
    } finally {
      setExporting(false);
    }
  }

  async function exportBoth() {
    if (state.exporting) return;
    setExporting(true, "正在同步生成…");
    try {
      const { svgText, pngBlob } = await createExportArtifacts();
      downloadBlob(pngBlob, "discount-poster.png");
      downloadBlob(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }), "discount-poster.svg");
      showToast("PNG 与可编辑 SVG 已同步导出");
    } catch (error) {
      console.error(error);
      showToast("导出失败，请重试");
    } finally {
      setExporting(false);
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function bindKeyboard() {
    document.addEventListener("keydown", (event) => {
      const target = event.target;
      if (target.matches?.("input, textarea, select")) return;
      const item = getSelected();
      if (!item) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelected();
        return;
      }
      const movement = event.shiftKey ? 10 : 2;
      const offsets = {
        ArrowLeft: [-movement, 0],
        ArrowRight: [movement, 0],
        ArrowUp: [0, -movement],
        ArrowDown: [0, movement],
      };
      if (offsets[event.key]) {
        event.preventDefault();
        const safe = avoidCriticalCenter(item, item.x + offsets[event.key][0], item.y + offsets[event.key][1]);
        item.x = safe.x;
        item.y = safe.y;
        refreshCanvas();
        renderLayerPositionOnly();
        saveState();
      }
    });
  }

  window.posterEditor = {
    selectItem,
    addSticker,
    reorderSelected,
    getState: () => JSON.parse(JSON.stringify({
      items: state.items,
      selectedId: state.selectedId,
      showSafeZone: state.showSafeZone,
    })),
    getSafeZone: () => ({ ...SAFE_ZONE }),
    exportSvgText: serializePoster,
    exportPngDataUrl: async () => blobToDataUrl(await svgToPngBlob(await serializePoster())),
    createExportArtifacts,
    dimensions: { width: WIDTH, height: HEIGHT },
  };

  async function init() {
    renderStickerLibrary();
    const restored = loadState();
    state.items = restored?.items || cloneBaseItems();
    state.selectedId = restored?.selectedId === undefined
      ? "sticker-burst-hero"
      : restored.selectedId;
    state.showSafeZone = restored?.showSafeZone ?? true;

    renderBackground();
    try {
      await Promise.all([
        document.fonts.load("400 32px 'Noto Sans SC Local'"),
        document.fonts.load("700 32px 'Noto Sans SC Local'"),
        document.fonts.load("900 32px 'Noto Sans SC Local'"),
      ]);
      await document.fonts.ready;
      state.fontReady = true;
    } catch (error) {
      console.warn("字体预加载未完成，使用系统后备字体", error);
    }

    $("#toggleSafeZone").setAttribute("aria-pressed", String(state.showSafeZone));
    refreshCanvas();
    renderLayerList();
    updateInspector();
    bindUiEvents();
    bindKeyboard();
    $("#exportPng").addEventListener("click", exportPngOnly);
    $("#exportSvg").addEventListener("click", exportSvgOnly);
    $("#exportBoth").addEventListener("click", exportBoth);
    document.body.dataset.ready = "true";
  }

  init().catch((error) => {
    console.error(error);
    showToast("编辑器初始化失败");
    document.body.dataset.ready = "error";
  });
})();
