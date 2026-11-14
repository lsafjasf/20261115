(() => {
  "use strict";

  const DESIGN = {
    width: 720,
    height: 960,
    scale: 2,
    safeMargin: 54,
    safe: { left: 97, top: 94, right: 623, bottom: 844 },
  };

  const PAPER_THEMES = [
    {
      id: "ivory",
      name: "暖象牙",
      paper: "#eee1ca",
      paperLight: "#f7ecd9",
      paperDeep: "#d9c8ae",
      ink: "#29251d",
      muted: "#705f47",
      accent: "#985039",
      glow: "#ffd18d",
      tagFill: "rgba(247, 235, 215, 0.68)",
    },
    {
      id: "mist",
      name: "雾灰",
      paper: "#e3ddd1",
      paperLight: "#eee9df",
      paperDeep: "#c8c1b6",
      ink: "#292824",
      muted: "#68645b",
      accent: "#805c53",
      glow: "#f3d3a4",
      tagFill: "rgba(238, 233, 223, 0.7)",
    },
    {
      id: "clay",
      name: "陶粉",
      paper: "#ecd8c8",
      paperLight: "#f7e6d8",
      paperDeep: "#d4bcab",
      ink: "#30241e",
      muted: "#785e50",
      accent: "#8e4b38",
      glow: "#ffca92",
      tagFill: "rgba(247, 230, 216, 0.7)",
    },
    {
      id: "sage",
      name: "鼠尾草",
      paper: "#dce1d2",
      paperLight: "#e9ecdf",
      paperDeep: "#c2c7b7",
      ink: "#283027",
      muted: "#606b57",
      accent: "#7b563d",
      glow: "#f0e1b5",
      tagFill: "rgba(233, 236, 223, 0.72)",
    },
  ];

  const ELEMENT_META = {
    title: {
      name: "主标题",
      glyph: "题",
      family: "serif",
      weight: 600,
      maxLength: 8,
      glowWeight: 1,
    },
    price: {
      name: "价格",
      glyph: "¥",
      family: "sans",
      weight: 500,
      maxLength: 8,
      glowWeight: 0.8,
    },
    tag: {
      name: "标签",
      glyph: "签",
      family: "sans",
      weight: 500,
      maxLength: 5,
      glowWeight: 0.5,
    },
  };

  function createInitialState() {
    return {
      palette: 0,
      glow: 0.68,
      guides: true,
      elements: [
        {
          id: "title",
          name: "主标题",
          type: "title",
          text: "晚风入梦",
          x: 360,
          y: 260,
          size: 104,
          spacing: 14,
          colorMode: "ink",
        },
        {
          id: "price",
          name: "价格",
          type: "price",
          text: "¥ 268",
          x: 360,
          y: 386,
          size: 60,
          spacing: 5,
          colorMode: "accent",
        },
        {
          id: "tag1",
          name: "标签 · 木质调",
          type: "tag",
          text: "木质调",
          x: 236,
          y: 714,
          size: 26,
          spacing: 4,
          colorMode: "ink",
        },
        {
          id: "tag2",
          name: "标签 · 植物蜡",
          type: "tag",
          text: "植物蜡",
          x: 360,
          y: 714,
          size: 26,
          spacing: 4,
          colorMode: "ink",
        },
        {
          id: "tag3",
          name: "标签 · 120g",
          type: "tag",
          text: "120g",
          x: 484,
          y: 714,
          size: 26,
          spacing: 4,
          colorMode: "ink",
        },
      ],
    };
  }

  const FONT_STACKS = {
    serif:
      '"Iowan Old Style", "Baskerville", "Songti SC", "Noto Serif CJK SC", "SimSun", serif',
    sans: '"Avenir Next", "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif',
  };

  const artboard = document.getElementById("artboard");
  const ctx = artboard.getContext("2d");
  const overlay = document.getElementById("overlay");
  const overlayCtx = overlay.getContext("2d");
  const thumbCanvas = document.getElementById("thumbCanvas");
  const thumbCtx = thumbCanvas.getContext("2d");
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = DESIGN.width;
  glowCanvas.height = DESIGN.height;
  const glowCtx = glowCanvas.getContext("2d");
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 256;
  textureCanvas.height = 256;
  const textureCtx = textureCanvas.getContext("2d");

  let state = createInitialState();
  let selectedId = "title";
  let history = [cloneState(state)];
  let historyIndex = 0;
  let historyTransactionStart = null;
  let appearanceSignature = "";
  let paperPattern = null;
  let calloutTimer = 0;
  let toastTimer = 0;
  let drag = null;

  function cloneState(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function selectedElement() {
    return state.elements.find((element) => element.id === selectedId) || state.elements[0];
  }

  function theme() {
    return PAPER_THEMES[state.palette] || PAPER_THEMES[0];
  }

  function fontFor(element, size = element.size) {
    const meta = ELEMENT_META[element.type];
    return `${meta.weight} ${size}px ${FONT_STACKS[meta.family]}`;
  }

  function textWidth(text, font, spacing) {
    measureCtx.font = font;
    const chars = Array.from(text);
    if (!chars.length) return 0;
    let width = 0;
    for (const char of chars) {
      width += measureCtx.measureText(char).width;
    }
    return width + spacing * Math.max(0, chars.length - 1);
  }

  function getMetrics(element) {
    const safeWidth = DESIGN.safe.right - DESIGN.safe.left;
    const safeHeight = DESIGN.safe.bottom - DESIGN.safe.top;
    let size = element.size;
    let spacing = element.spacing;
    const rawWidth = textWidth(element.text, fontFor(element, size), spacing);
    const pillPadding = element.type === "tag" ? 32 : 0;
    const rawTotalWidth = rawWidth + pillPadding;
    const rawHeight = element.type === "tag" ? size + 28 : size * 1.12;
    const widthRatio = rawTotalWidth > safeWidth ? safeWidth / rawTotalWidth : 1;
    const heightRatio = rawHeight > safeHeight ? safeHeight / rawHeight : 1;
    const fit = Math.min(widthRatio, heightRatio, 1);

    if (fit < 1) {
      size *= fit;
      spacing *= fit;
    }

    const innerWidth = textWidth(element.text, fontFor(element, size), spacing);
    const width = innerWidth + (element.type === "tag" ? 32 : 0);
    const height = element.type === "tag" ? size + 28 : size * 1.12;

    return { size, spacing, innerWidth, width, height, fit };
  }

  function elementBounds(element) {
    const metrics = getMetrics(element);
    return {
      x: element.x - metrics.width / 2,
      y: element.y - metrics.height / 2,
      width: metrics.width,
      height: metrics.height,
      metrics,
    };
  }

  function clampElement(element) {
    const bounds = elementBounds(element);
    const paddedWidth = Math.min(bounds.width, DESIGN.safe.right - DESIGN.safe.left);
    const paddedHeight = Math.min(bounds.height, DESIGN.safe.bottom - DESIGN.safe.top);
    element.x = clamp(
      element.x,
      DESIGN.safe.left + paddedWidth / 2,
      DESIGN.safe.right - paddedWidth / 2,
    );
    element.y = clamp(
      element.y,
      DESIGN.safe.top + paddedHeight / 2,
      DESIGN.safe.bottom - paddedHeight / 2,
    );
  }

  function clampAllElements() {
    for (const element of state.elements) {
      clampElement(element);
    }
  }

  function isAtSafeEdge(element) {
    const bounds = elementBounds(element);
    const tolerance = 1.2;
    return (
      Math.abs(bounds.x - DESIGN.safe.left) <= tolerance ||
      Math.abs(bounds.x + bounds.width - DESIGN.safe.right) <= tolerance ||
      Math.abs(bounds.y - DESIGN.safe.top) <= tolerance ||
      Math.abs(bounds.y + bounds.height - DESIGN.safe.bottom) <= tolerance
    );
  }

  function hasTightGlow(element) {
    const metrics = getMetrics(element);
    if (state.glow < 0.34 || metrics.size < 1) return false;
    return metrics.spacing / metrics.size < 0.062;
  }

  function safeInsets() {
    const paper = { left: 43, top: 40, right: 677, bottom: 898 };
    return {
      left: DESIGN.safe.left - paper.left,
      top: DESIGN.safe.top - paper.top,
      right: paper.right - DESIGN.safe.right,
      bottom: paper.bottom - DESIGN.safe.bottom,
    };
  }

  function roundRectPath(targetCtx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    targetCtx.beginPath();
    targetCtx.moveTo(x + r, y);
    targetCtx.arcTo(x + width, y, x + width, y + height, r);
    targetCtx.arcTo(x + width, y + height, x, y + height, r);
    targetCtx.arcTo(x, y + height, x, y, r);
    targetCtx.arcTo(x, y, x + width, y, r);
    targetCtx.closePath();
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }

  function makePaperTexture() {
    const random = seededRandom(253);
    const image = textureCtx.createImageData(textureCanvas.width, textureCanvas.height);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
      const grain = random();
      const value = grain > 0.55 ? 255 : 58 + Math.floor(random() * 60);
      data[index] = value;
      data[index + 1] = value - 6;
      data[index + 2] = value - 16;
      data[index + 3] = grain > 0.82 ? 18 : 4 + Math.floor(random() * 7);
    }
    textureCtx.putImageData(image, 0, 0);
    textureCtx.lineCap = "round";
    for (let index = 0; index < 42; index += 1) {
      const x = random() * 256;
      const y = random() * 256;
      textureCtx.strokeStyle = `rgba(92, 72, 45, ${0.025 + random() * 0.04})`;
      textureCtx.lineWidth = 0.45 + random() * 0.45;
      textureCtx.beginPath();
      textureCtx.moveTo(x, y);
      textureCtx.quadraticCurveTo(
        x + random() * 28 - 14,
        y + random() * 18,
        x + random() * 44 - 22,
        y + random() * 38,
      );
      textureCtx.stroke();
    }
    paperPattern = ctx.createPattern(textureCanvas, "repeat");
  }

  function drawBackground() {
    const background = ctx.createLinearGradient(0, 0, DESIGN.width, DESIGN.height);
    background.addColorStop(0, "#d8d0c3");
    background.addColorStop(0.48, "#c6bcae");
    background.addColorStop(1, "#aea394");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, DESIGN.width, DESIGN.height);

    const vignette = ctx.createRadialGradient(360, 410, 140, 360, 480, 560);
    vignette.addColorStop(0, "rgba(255, 247, 228, 0.16)");
    vignette.addColorStop(0.7, "rgba(255, 247, 228, 0)");
    vignette.addColorStop(1, "rgba(55, 42, 27, 0.16)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, DESIGN.width, DESIGN.height);
  }

  function drawFrameShadow() {
    ctx.save();
    ctx.shadowColor = "rgba(37, 26, 14, 0.55)";
    ctx.shadowBlur = 45;
    ctx.shadowOffsetY = 25;
    roundRectPath(ctx, 25, 22, 670, 892, 22);
    ctx.fillStyle = "#27221b";
    ctx.fill();
    ctx.restore();

    const frameGradient = ctx.createLinearGradient(0, 22, 0, 914);
    frameGradient.addColorStop(0, "#544b3d");
    frameGradient.addColorStop(0.035, "#2b2720");
    frameGradient.addColorStop(0.16, "#201d18");
    frameGradient.addColorStop(0.72, "#181613");
    frameGradient.addColorStop(1, "#302b23");
    roundRectPath(ctx, 25, 22, 670, 892, 22);
    ctx.fillStyle = frameGradient;
    ctx.fill();

    ctx.save();
    roundRectPath(ctx, 25, 22, 670, 892, 22);
    ctx.strokeStyle = "rgba(223, 192, 143, 0.36)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    roundRectPath(ctx, 33, 30, 654, 876, 16);
    ctx.strokeStyle = "rgba(255, 235, 196, 0.11)";
    ctx.lineWidth = 1;
    ctx.stroke();

    roundRectPath(ctx, 38, 35, 644, 866, 13);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.62)";
    ctx.lineWidth = 4;
    ctx.stroke();

    roundRectPath(ctx, 42, 39, 636, 858, 11);
    ctx.strokeStyle = "rgba(202, 167, 111, 0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawPaper(currentTheme) {
    const paperGradient = ctx.createLinearGradient(45, 40, 674, 900);
    paperGradient.addColorStop(0, currentTheme.paperLight);
    paperGradient.addColorStop(0.46, currentTheme.paper);
    paperGradient.addColorStop(1, currentTheme.paperDeep);
    roundRectPath(ctx, 43, 40, 634, 858, 10);
    ctx.fillStyle = paperGradient;
    ctx.fill();

    ctx.save();
    roundRectPath(ctx, 43, 40, 634, 858, 10);
    ctx.clip();
    ctx.fillStyle = paperPattern;
    ctx.globalAlpha = 0.62;
    ctx.fillRect(43, 40, 634, 858);
    ctx.globalAlpha = 1;

    const paperWarmth = ctx.createRadialGradient(360, 358, 10, 360, 358, 390);
    paperWarmth.addColorStop(0, `rgba(255, 241, 211, ${0.14 + state.glow * 0.14})`);
    paperWarmth.addColorStop(0.55, "rgba(255, 241, 211, 0.03)");
    paperWarmth.addColorStop(1, "rgba(92, 65, 35, 0.075)");
    ctx.fillStyle = paperWarmth;
    ctx.fillRect(43, 40, 634, 858);

    const topShade = ctx.createLinearGradient(0, 40, 0, 92);
    topShade.addColorStop(0, "rgba(85, 58, 29, 0.16)");
    topShade.addColorStop(1, "rgba(85, 58, 29, 0)");
    ctx.fillStyle = topShade;
    ctx.fillRect(43, 40, 634, 52);

    const bottomShade = ctx.createLinearGradient(0, 836, 0, 898);
    bottomShade.addColorStop(0, "rgba(85, 58, 29, 0)");
    bottomShade.addColorStop(1, "rgba(85, 58, 29, 0.14)");
    ctx.fillStyle = bottomShade;
    ctx.fillRect(43, 836, 634, 62);
    ctx.restore();
  }

  function drawSpacedText(targetCtx, text, centerX, centerY, font, spacing, color, alpha = 1) {
    const chars = Array.from(text);
    if (!chars.length) return;
    targetCtx.save();
    targetCtx.font = font;
    targetCtx.textAlign = "left";
    targetCtx.textBaseline = "middle";
    targetCtx.fillStyle = color;
    targetCtx.globalAlpha = alpha;
    const widths = chars.map((char) => targetCtx.measureText(char).width);
    const total = widths.reduce((sum, width) => sum + width, 0) + spacing * (chars.length - 1);
    let cursor = centerX - total / 2;
    for (let index = 0; index < chars.length; index += 1) {
      targetCtx.fillText(chars[index], cursor, centerY);
      cursor += widths[index] + spacing;
    }
    targetCtx.restore();
  }

  function drawElementGlow(targetCtx, element, currentTheme) {
    const metrics = getMetrics(element);
    const font = fontFor(element, metrics.size);
    const weight = ELEMENT_META[element.type].glowWeight;
    const glowColor = currentTheme.glow;

    targetCtx.save();
    targetCtx.globalCompositeOperation = "lighter";

    const haloRadius =
      element.type === "tag"
        ? Math.max(metrics.width * 0.62, 52)
        : Math.max(metrics.width * 0.52, 70);
    const halo = targetCtx.createRadialGradient(
      element.x,
      element.y,
      0,
      element.x,
      element.y,
      haloRadius,
    );
    halo.addColorStop(0, `rgba(255, 202, 122, ${0.12 * state.glow * weight})`);
    halo.addColorStop(0.42, `rgba(255, 197, 112, ${0.075 * state.glow * weight})`);
    halo.addColorStop(1, "rgba(255, 190, 99, 0)");
    targetCtx.fillStyle = halo;
    targetCtx.fillRect(
      element.x - haloRadius,
      element.y - haloRadius,
      haloRadius * 2,
      haloRadius * 2,
    );

    targetCtx.filter = `blur(${element.type === "tag" ? 7 : 11}px)`;
    drawSpacedText(
      targetCtx,
      element.text,
      element.x,
      element.y,
      font,
      metrics.spacing,
      glowColor,
      0.38 * state.glow * weight,
    );

    if (element.type === "tag") {
      targetCtx.fillStyle = `rgba(255, 207, 138, ${0.1 * state.glow})`;
      roundRectPath(
        targetCtx,
        element.x - metrics.width / 2,
        element.y - metrics.height / 2,
        metrics.width,
        metrics.height,
        metrics.height / 2,
      );
      targetCtx.fill();
    }
    targetCtx.restore();
  }

  function drawGlowLayer(currentTheme) {
    glowCtx.clearRect(0, 0, DESIGN.width, DESIGN.height);
    if (state.glow <= 0.005) return;
    for (const element of state.elements) {
      drawElementGlow(glowCtx, element, currentTheme);
    }
  }

  function drawDecorations(currentTheme) {
    ctx.save();
    ctx.strokeStyle = "rgba(102, 78, 50, 0.3)";
    ctx.lineWidth = 0.65;

    ctx.beginPath();
    ctx.moveTo(116, 126);
    ctx.lineTo(238, 126);
    ctx.moveTo(482, 126);
    ctx.lineTo(604, 126);
    ctx.stroke();

    drawSpacedText(
      ctx,
      "EVENING AIR · No. 07",
      360,
      126,
      '500 10px "Avenir Next", "PingFang SC", sans-serif',
      2.1,
      currentTheme.muted,
      0.86,
    );

    ctx.strokeStyle = "rgba(142, 92, 54, 0.2)";
    ctx.beginPath();
    ctx.arc(360, 574, 54, Math.PI * 0.08, Math.PI * 1.48);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(377, 557, 39, Math.PI * 1.08, Math.PI * 1.9);
    ctx.strokeStyle = "rgba(142, 92, 54, 0.1)";
    ctx.stroke();

    ctx.fillStyle = "rgba(127, 83, 48, 0.72)";
    ctx.beginPath();
    ctx.arc(405, 538, 3.2, 0, Math.PI * 2);
    ctx.fill();

    drawSpacedText(
      ctx,
      "WANING LIGHT",
      405,
      620,
      '500 7.5px "Avenir Next", "PingFang SC", sans-serif',
      1.4,
      currentTheme.muted,
      0.62,
    );

    ctx.strokeStyle = "rgba(102, 78, 50, 0.26)";
    ctx.lineWidth = 0.65;
    ctx.beginPath();
    ctx.moveTo(286, 485);
    ctx.lineTo(422, 485);
    ctx.stroke();
    ctx.fillStyle = "rgba(147, 98, 58, 0.55)";
    ctx.beginPath();
    ctx.moveTo(354, 480);
    ctx.lineTo(357, 485);
    ctx.lineTo(354, 490);
    ctx.lineTo(351, 485);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(102, 78, 50, 0.2)";
    ctx.beginPath();
    ctx.moveTo(304, 826);
    ctx.lineTo(416, 826);
    ctx.stroke();

    drawSpacedText(
      ctx,
      "HAND-POURED IN SMALL BATCHES",
      360,
      846,
      '500 8px "Avenir Next", "PingFang SC", sans-serif',
      1.8,
      currentTheme.muted,
      0.75,
    );

    ctx.fillStyle = "rgba(105, 78, 48, 0.28)";
    ctx.font = '500 8px "Avenir Next", "PingFang SC", sans-serif';
    ctx.textAlign = "left";
    ctx.fillText("07", 82, 846);
    ctx.textAlign = "right";
    ctx.fillText("SHANGHAI", 638, 846);
    ctx.restore();
  }

  function drawElement(element, currentTheme) {
    const metrics = getMetrics(element);
    const bounds = elementBounds(element);
    const font = fontFor(element, metrics.size);
    const color =
      element.colorMode === "accent"
        ? currentTheme.accent
        : element.colorMode === "muted"
          ? currentTheme.muted
          : currentTheme.ink;

    if (element.type === "tag") {
      ctx.save();
      ctx.fillStyle = currentTheme.tagFill;
      ctx.strokeStyle = "rgba(102, 73, 43, 0.32)";
      ctx.lineWidth = 0.8;
      roundRectPath(
        ctx,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        bounds.height / 2,
      );
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = currentTheme.accent;
      ctx.globalAlpha = 0.72;
      ctx.beginPath();
      ctx.arc(bounds.x + 14, element.y, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    if (element.type === "title") {
      ctx.shadowColor = "rgba(69, 43, 20, 0.12)";
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
    }
    drawSpacedText(
      ctx,
      element.text,
      element.x,
      element.y,
      font,
      metrics.spacing,
      color,
      1,
    );
    ctx.restore();
  }

  function drawInnerEdge() {
    ctx.save();
    roundRectPath(ctx, 42, 39, 636, 858, 11);
    ctx.clip();
    ctx.strokeStyle = "rgba(62, 43, 23, 0.18)";
    ctx.lineWidth = 9;
    roundRectPath(ctx, 38, 35, 644, 866, 14);
    ctx.stroke();
    ctx.restore();

    roundRectPath(ctx, 42, 39, 636, 858, 11);
    ctx.strokeStyle = "rgba(226, 194, 143, 0.38)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  function drawArtwork(targetCtx) {
    const currentTheme = theme();
    targetCtx.clearRect(0, 0, DESIGN.width, DESIGN.height);
    drawBackground();
    drawFrameShadow();
    drawPaper(currentTheme);
    drawDecorations(currentTheme);
    drawGlowLayer(currentTheme);

    if (state.glow > 0.005) {
      targetCtx.save();
      targetCtx.globalCompositeOperation = "screen";
      targetCtx.globalAlpha = 0.48 + state.glow * 0.45;
      targetCtx.drawImage(glowCanvas, 0, 0, DESIGN.width, DESIGN.height);
      targetCtx.restore();
    }

    for (const element of state.elements) {
      drawElement(element, currentTheme);
    }
    drawInnerEdge();
  }

  function drawOverlay() {
    overlayCtx.clearRect(0, 0, DESIGN.width, DESIGN.height);
    overlayCtx.save();
    overlayCtx.lineCap = "round";
    overlayCtx.lineJoin = "round";

    if (state.guides) {
      overlayCtx.save();
      overlayCtx.strokeStyle = "rgba(232, 194, 130, 0.34)";
      overlayCtx.lineWidth = 0.7;
      overlayCtx.setLineDash([4, 5]);
      overlayCtx.strokeRect(
        DESIGN.safe.left,
        DESIGN.safe.top,
        DESIGN.safe.right - DESIGN.safe.left,
        DESIGN.safe.bottom - DESIGN.safe.top,
      );
      overlayCtx.setLineDash([]);
      overlayCtx.strokeStyle = "rgba(232, 194, 130, 0.58)";
      overlayCtx.lineWidth = 0.8;

      const corner = 10;
      const corners = [
        [DESIGN.safe.left, DESIGN.safe.top, 1, 1],
        [DESIGN.safe.right, DESIGN.safe.top, -1, 1],
        [DESIGN.safe.left, DESIGN.safe.bottom, 1, -1],
        [DESIGN.safe.right, DESIGN.safe.bottom, -1, -1],
      ];
      for (const [x, y, dx, dy] of corners) {
        overlayCtx.beginPath();
        overlayCtx.moveTo(x + dx * corner, y);
        overlayCtx.lineTo(x, y);
        overlayCtx.lineTo(x, y + dy * corner);
        overlayCtx.stroke();
      }

      overlayCtx.fillStyle = "rgba(44, 32, 20, 0.74)";
      overlayCtx.font = '500 9px "Avenir Next", "PingFang SC", sans-serif';
      overlayCtx.textAlign = "left";
      overlayCtx.textBaseline = "middle";
      const label = `安全留白 ${safeInsets().left}px`;
      const labelWidth = overlayCtx.measureText(label).width + 13;
      roundRectPath(overlayCtx, DESIGN.safe.left, DESIGN.safe.top - 18, labelWidth, 13, 3);
      overlayCtx.fill();
      overlayCtx.fillStyle = "rgba(231, 199, 145, 0.92)";
      overlayCtx.fillText(label, DESIGN.safe.left + 6.5, DESIGN.safe.top - 11);
      overlayCtx.restore();
    }

    const element = selectedElement();
    if (element) {
      const bounds = elementBounds(element);
      const padding = 7;
      const warning = hasTightGlow(element) || isAtSafeEdge(element);
      overlayCtx.save();
      overlayCtx.strokeStyle = warning
        ? "rgba(228, 157, 93, 0.92)"
        : "rgba(237, 201, 142, 0.86)";
      overlayCtx.lineWidth = 1;
      overlayCtx.setLineDash([3, 3]);
      overlayCtx.strokeRect(
        bounds.x - padding,
        bounds.y - padding,
        bounds.width + padding * 2,
        bounds.height + padding * 2,
      );
      overlayCtx.setLineDash([]);

      const handles = [
        [bounds.x - padding, bounds.y - padding],
        [bounds.x + bounds.width + padding, bounds.y - padding],
        [bounds.x - padding, bounds.y + bounds.height + padding],
        [bounds.x + bounds.width + padding, bounds.y + bounds.height + padding],
      ];
      overlayCtx.fillStyle = "#d6ad6a";
      overlayCtx.strokeStyle = "#2a241b";
      overlayCtx.lineWidth = 1.1;
      for (const [x, y] of handles) {
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, 2.1, 0, Math.PI * 2);
        overlayCtx.fill();
        overlayCtx.stroke();
      }

      const label = ELEMENT_META[element.type].name;
      overlayCtx.font = '500 9px "Avenir Next", "PingFang SC", sans-serif';
      overlayCtx.textAlign = "left";
      overlayCtx.textBaseline = "middle";
      const textWidth = overlayCtx.measureText(label).width;
      const pillWidth = textWidth + 11;
      const pillTop = bounds.y - padding - 17;
      overlayCtx.fillStyle = warning ? "rgba(82, 49, 25, 0.94)" : "rgba(42, 35, 25, 0.9)";
      roundRectPath(
        overlayCtx,
        bounds.x - padding,
        pillTop,
        pillWidth,
        12,
        3,
      );
      overlayCtx.fill();
      overlayCtx.fillStyle = warning ? "#f0b77a" : "#e8c992";
      overlayCtx.fillText(label, bounds.x - padding + 5.5, pillTop + 6);
      overlayCtx.restore();
    }

    overlayCtx.restore();
  }

  function drawThumbnail() {
    thumbCanvas.width = 180;
    thumbCanvas.height = 240;
    thumbCtx.clearRect(0, 0, 180, 240);
    thumbCtx.imageSmoothingEnabled = true;
    thumbCtx.imageSmoothingQuality = "high";
    thumbCtx.drawImage(artboard, 0, 0, 1440, 1920, 0, 0, 180, 240);
  }

  function readabilityReport() {
    const title = state.elements.find((element) => element.type === "title");
    const price = state.elements.find((element) => element.type === "price");
    const tags = state.elements.filter((element) => element.type === "tag");
    const smallestTag = Math.min(...tags.map((element) => getMetrics(element).size));
    return {
      scale: 0.25,
      titlePx: title ? getMetrics(title).size * 0.25 : 0,
      pricePx: price ? getMetrics(price).size * 0.25 : 0,
      tagPx: Number.isFinite(smallestTag) ? smallestTag * 0.25 : 0,
      passes: Boolean(
        title &&
          price &&
          tags.length === 3 &&
          getMetrics(title).size * 0.25 >= 16 &&
          getMetrics(price).size * 0.25 >= 11 &&
          smallestTag * 0.25 >= 5.5,
      ),
    };
  }

  function startHistoryTransaction() {
    if (!historyTransactionStart) {
      historyTransactionStart = cloneState(state);
    }
  }

  function finishHistoryTransaction() {
    if (!historyTransactionStart) return false;
    const changed = JSON.stringify(historyTransactionStart) !== JSON.stringify(state);
    historyTransactionStart = null;
    if (!changed) return false;
    history = history.slice(0, historyIndex + 1);
    history.push(cloneState(state));
    if (history.length > 60) history.shift();
    historyIndex = history.length - 1;
    updateHistoryButtons();
    return true;
  }

  function commitInline(mutator) {
    startHistoryTransaction();
    mutator();
    clampAllElements();
    finishHistoryTransaction();
    renderAll();
  }

  function undo() {
    finishHistoryTransaction();
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    state = cloneState(history[historyIndex]);
    if (!state.elements.some((element) => element.id === selectedId)) {
      selectedId = state.elements[0].id;
    }
    renderAll();
    showToast("已撤销上一步");
  }

  function redo() {
    finishHistoryTransaction();
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    state = cloneState(history[historyIndex]);
    if (!state.elements.some((element) => element.id === selectedId)) {
      selectedId = state.elements[0].id;
    }
    renderAll();
    showToast("已重做");
  }

  function updateHistoryButtons() {
    document.getElementById("undoButton").disabled = historyIndex <= 0;
    document.getElementById("redoButton").disabled = historyIndex >= history.length - 1;
  }

  function layerGlyph(element) {
    return ELEMENT_META[element.type].glyph;
  }

  function renderLayerList() {
    const list = document.getElementById("layerList");
    list.innerHTML = "";
    for (const element of state.elements) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `layer-row${element.id === selectedId ? " is-selected" : ""}`;
      button.dataset.id = element.id;
      button.setAttribute("aria-pressed", element.id === selectedId ? "true" : "false");

      const glyph = document.createElement("span");
      glyph.className = "layer-glyph";
      glyph.textContent = layerGlyph(element);

      const copy = document.createElement("span");
      copy.className = "layer-copy";
      const title = document.createElement("strong");
      title.textContent = element.name;
      const meta = document.createElement("span");
      meta.textContent = `${element.type === "tag" ? "LABEL" : element.type.toUpperCase()} · ${
        element.text
      }`;
      copy.append(title, meta);

      const grip = document.createElement("span");
      grip.className = "layer-lock";
      grip.innerHTML =
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5h6v6H5zM3 2v3M3 2h3M13 2v3M13 2h-3M3 14v-3M3 14h3M13 14v-3M13 14h-3"/></svg>';

      button.append(glyph, copy, grip);
      button.addEventListener("click", () => {
        finishHistoryTransaction();
        selectedId = element.id;
        renderAll();
        showCallout(`已选中${ELEMENT_META[element.type].name}`);
      });
      list.append(button);
    }
  }

  function inferAlignment(element) {
    const bounds = elementBounds(element);
    const tolerance = 1.1;
    let horizontal = "free";
    let vertical = "free";
    if (Math.abs(bounds.x - DESIGN.safe.left) <= tolerance) horizontal = "left";
    else if (Math.abs(bounds.x + bounds.width - DESIGN.safe.right) <= tolerance) horizontal = "right";
    else if (Math.abs(element.x - (DESIGN.safe.left + DESIGN.safe.right) / 2) <= tolerance) {
      horizontal = "center";
    }
    if (Math.abs(bounds.y - DESIGN.safe.top) <= tolerance) vertical = "top";
    else if (Math.abs(bounds.y + bounds.height - DESIGN.safe.bottom) <= tolerance) vertical = "bottom";
    else if (Math.abs(element.y - (DESIGN.safe.top + DESIGN.safe.bottom) / 2) <= tolerance) {
      vertical = "middle";
    }
    return { horizontal, vertical };
  }

  function renderInspector() {
    const element = selectedElement();
    if (!element) return;
    const meta = ELEMENT_META[element.type];
    const metrics = getMetrics(element);
    const alignment = inferAlignment(element);
    const textInput = document.getElementById("textInput");
    const spacingInput = document.getElementById("spacingInput");
    const glowInput = document.getElementById("glowInput");

    document.getElementById("selectedName").textContent = element.name;
    if (document.activeElement !== textInput) textInput.value = element.text;
    textInput.maxLength = meta.maxLength;
    document.getElementById("charCount").textContent = `${Array.from(element.text).length} / ${
      meta.maxLength
    }`;

    spacingInput.value = String(Math.round(element.spacing));
    document.getElementById("spacingValue").textContent = `${Math.round(element.spacing)} px`;
    spacingInput.max = element.type === "title" ? "34" : "20";

    const alignNames = {
      left: "左对齐",
      center: "水平居中",
      right: "右对齐",
      top: "顶部",
      middle: "垂直居中",
      bottom: "底部",
      free: "自由",
    };
    document.getElementById("alignValue").textContent =
      alignment.horizontal === "free" && alignment.vertical === "free"
        ? "自由定位"
        : `${alignNames[alignment.horizontal]} · ${alignNames[alignment.vertical]}`;

    for (const button of document.querySelectorAll("[data-align-x]")) {
      button.classList.toggle(
        "is-active",
        button.dataset.alignX === alignment.horizontal,
      );
    }
    for (const button of document.querySelectorAll("[data-align-y]")) {
      button.classList.toggle(
        "is-active",
        button.dataset.alignY === alignment.vertical,
      );
    }

    glowInput.value = String(Math.round(state.glow * 100));
    document.getElementById("glowValue").textContent = `${Math.round(state.glow * 100)}%`;
    document.querySelector(".glow-orb").style.left = `${state.glow * 100}%`;

    const glowDescription =
      state.glow < 0.08
        ? "光晕关闭，纸面呈现哑光质感"
        : state.glow < 0.38
          ? "柔光克制，边缘轮廓清晰"
          : state.glow < 0.76
            ? "暖光均匀，文字边缘柔和"
            : "高亮泛光，适合暗环境橱窗";
    document.getElementById("glowDescription").textContent = glowDescription;
    document.getElementById("glowSwatch").style.boxShadow =
      `0 0 ${6 + state.glow * 21}px rgba(231, 187, 113, ${0.12 + state.glow * 0.38})`;

    const tight = hasTightGlow(element);
    document.getElementById("spacingAlert").hidden = !tight;

    const tags = state.elements.filter((item) => item.type === "tag");
    const allInside = state.elements.every((item) => {
      const bounds = elementBounds(item);
      return (
        bounds.x >= DESIGN.safe.left - 0.5 &&
        bounds.y >= DESIGN.safe.top - 0.5 &&
        bounds.x + bounds.width <= DESIGN.safe.right + 0.5 &&
        bounds.y + bounds.height <= DESIGN.safe.bottom + 0.5
      );
    });
    const report = readabilityReport();
    const status = document.getElementById("readabilityStatus");
    status.textContent = report.passes && allInside && tags.length === 3 ? "清晰可读" : "需要调整";
    status.style.color =
      report.passes && allInside && tags.length === 3 ? "#c7d6ac" : "#e0a272";

    for (const button of document.querySelectorAll(".palette-swatch")) {
      const index = Number(button.dataset.palette);
      button.setAttribute("aria-pressed", String(index === state.palette));
    }
    const paletteValue = document.querySelector(".palette-block .setting-value");
    if (paletteValue) paletteValue.textContent = theme().name;
    document
      .getElementById("guideToggle")
      .classList.toggle("is-active", state.guides);
    document
      .getElementById("guideToggle")
      .setAttribute("aria-pressed", String(state.guides));

    const zoom = Math.round(
      (document.getElementById("artboardWrap").getBoundingClientRect().width / DESIGN.width) *
        100,
    );
    document.getElementById("zoomValue").textContent = `${zoom}%`;
    document.getElementById("selectionDot").style.background =
      tight || !allInside ? "rgba(227, 168, 109, 0.25)" : "rgba(214, 173, 106, 0.25)";
    return metrics;
  }

  function renderAll() {
    clampAllElements();
    ctx.setTransform(DESIGN.scale, 0, 0, DESIGN.scale, 0, 0);
    drawArtwork(ctx);
    overlayCtx.setTransform(DESIGN.scale, 0, 0, DESIGN.scale, 0, 0);
    drawOverlay();
    drawThumbnail();
    renderLayerList();
    renderInspector();
    updateHistoryButtons();
  }

  function showCallout(message, warning = false) {
    const callout = document.getElementById("canvasCallout");
    callout.textContent = message;
    callout.classList.toggle("is-warning", warning);
    callout.classList.add("is-visible");
    window.clearTimeout(calloutTimer);
    calloutTimer = window.setTimeout(() => {
      callout.classList.remove("is-visible");
    }, 1700);
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    document.getElementById("toastMessage").textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }

  function pointOnCanvas(event) {
    const rect = overlay.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * DESIGN.width,
      y: ((event.clientY - rect.top) / rect.height) * DESIGN.height,
    };
  }

  function hitTest(point) {
    for (let index = state.elements.length - 1; index >= 0; index -= 1) {
      const element = state.elements[index];
      const bounds = elementBounds(element);
      const padding = 5;
      if (
        point.x >= bounds.x - padding &&
        point.x <= bounds.x + bounds.width + padding &&
        point.y >= bounds.y - padding &&
        point.y <= bounds.y + bounds.height + padding
      ) {
        return element;
      }
    }
    return null;
  }

  function selectElement(id) {
    finishHistoryTransaction();
    if (!state.elements.some((element) => element.id === id)) return;
    selectedId = id;
    renderAll();
  }

  function alignSelected(axis, value) {
    const element = selectedElement();
    if (!element) return;
    commitInline(() => {
      const bounds = elementBounds(element);
      if (axis === "x") {
        if (value === "left") element.x = DESIGN.safe.left + bounds.width / 2;
        if (value === "center") {
          element.x = (DESIGN.safe.left + DESIGN.safe.right) / 2;
        }
        if (value === "right") element.x = DESIGN.safe.right - bounds.width / 2;
      } else {
        if (value === "top") element.y = DESIGN.safe.top + bounds.height / 2;
        if (value === "middle") {
          element.y = (DESIGN.safe.top + DESIGN.safe.bottom) / 2;
        }
        if (value === "bottom") element.y = DESIGN.safe.bottom - bounds.height / 2;
      }
    });
    showCallout("已对齐到安全区");
  }

  function bindCanvasInteraction() {
    overlay.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const point = pointOnCanvas(event);
      const element = hitTest(point);
      if (!element) return;
      finishHistoryTransaction();
      selectedId = element.id;
      startHistoryTransaction();
      drag = {
        pointerId: event.pointerId,
        element,
        startX: point.x,
        startY: point.y,
        elementX: element.x,
        elementY: element.y,
        moved: false,
      };
      overlay.setPointerCapture(event.pointerId);
      overlay.classList.add("is-dragging");
      renderAll();
    });

    overlay.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) {
        const point = pointOnCanvas(event);
        overlay.style.cursor = hitTest(point) ? "grab" : "default";
        return;
      }
      const point = pointOnCanvas(event);
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 0.4) drag.moved = true;
      drag.element.x = drag.elementX + dx;
      drag.element.y = drag.elementY + dy;
      clampElement(drag.element);
      renderAll();
    });

    const endDrag = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      overlay.classList.remove("is-dragging");
      overlay.style.cursor = "grab";
      const moved = drag.moved;
      const element = drag.element;
      drag = null;
      finishHistoryTransaction();
      if (moved) {
        const atEdge = isAtSafeEdge(element);
        showCallout(atEdge ? "已贴齐安全留白边界" : "位置已更新", atEdge);
      }
    };
    overlay.addEventListener("pointerup", endDrag);
    overlay.addEventListener("pointercancel", endDrag);
  }

  function bindInspector() {
    const textInput = document.getElementById("textInput");
    const spacingInput = document.getElementById("spacingInput");
    const glowInput = document.getElementById("glowInput");

    textInput.addEventListener("focus", startHistoryTransaction);
    textInput.addEventListener("input", () => {
      const element = selectedElement();
      if (!element) return;
      element.text = textInput.value;
      if (element.type === "tag") {
        element.name = `标签 · ${element.text || "未命名"}`;
      }
      clampAllElements();
      renderAll();
    });
    const finishText = () => {
      finishHistoryTransaction();
      renderAll();
    };
    textInput.addEventListener("blur", finishText);
    textInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        textInput.blur();
      }
      if (event.key === "Escape") {
        textInput.blur();
      }
    });

    const beginRange = () => startHistoryTransaction();
    const finishRange = () => {
      finishHistoryTransaction();
      renderAll();
    };
    for (const input of [spacingInput, glowInput]) {
      input.addEventListener("pointerdown", beginRange);
      input.addEventListener("focus", beginRange);
      input.addEventListener("change", finishRange);
      input.addEventListener("blur", finishRange);
    }

    spacingInput.addEventListener("input", () => {
      const element = selectedElement();
      if (!element) return;
      element.spacing = Number(spacingInput.value);
      clampAllElements();
      renderAll();
      const tight = hasTightGlow(element);
      if (tight) {
        showCallout("字距过密：光晕正在字间黏连", true);
      }
    });

    glowInput.addEventListener("input", () => {
      state.glow = Number(glowInput.value) / 100;
      renderAll();
    });

    for (const button of document.querySelectorAll("[data-align-x]")) {
      button.addEventListener("click", () => alignSelected("x", button.dataset.alignX));
    }
    for (const button of document.querySelectorAll("[data-align-y]")) {
      button.addEventListener("click", () => alignSelected("y", button.dataset.alignY));
    }

    for (const button of document.querySelectorAll(".palette-swatch")) {
      button.addEventListener("click", () => {
        commitInline(() => {
          state.palette = Number(button.dataset.palette);
        });
        showToast(`纸张已切换为${theme().name}`);
      });
    }

    document.getElementById("guideToggle").addEventListener("click", () => {
      commitInline(() => {
        state.guides = !state.guides;
      });
      showCallout(state.guides ? "安全区辅助线已显示" : "安全区辅助线已隐藏");
    });

    document.getElementById("resetButton").addEventListener("click", () => {
      startHistoryTransaction();
      state = createInitialState();
      selectedId = "title";
      finishHistoryTransaction();
      renderAll();
      showToast("已恢复初始构图");
    });
  }

  function bindHistoryAndShortcuts() {
    document.getElementById("undoButton").addEventListener("click", undo);
    document.getElementById("redoButton").addEventListener("click", redo);

    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const isTyping =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      const modifier = event.ctrlKey || event.metaKey;

      if (modifier && event.key.toLowerCase() === "z" && !isTyping) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "y" && !isTyping) {
        event.preventDefault();
        redo();
        return;
      }
      if (isTyping) return;

      const directions = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (directions[event.key]) {
        event.preventDefault();
        const element = selectedElement();
        if (!element) return;
        const step = event.shiftKey ? 8 : 2;
        startHistoryTransaction();
        element.x += directions[event.key][0] * step;
        element.y += directions[event.key][1] * step;
        clampElement(element);
        finishHistoryTransaction();
        renderAll();
      }
    });
  }

  function exportPng() {
    const button = document.getElementById("exportButton");
    button.disabled = true;
    button.querySelector("span").textContent = "正在导出";
    clampAllElements();
    ctx.setTransform(DESIGN.scale, 0, 0, DESIGN.scale, 0, 0);
    drawArtwork(ctx);
    artboard.toBlob(
      (blob) => {
        button.disabled = false;
        button.querySelector("span").textContent = "导出 PNG";
        if (!blob) {
          showToast("导出失败，请重试");
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "lumen-evening-air-lightbox-1440x1920.png";
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1200);
        showToast("PNG 已导出 · 1440 × 1920");
      },
      "image/png",
      1,
    );
  }

  function smallPreviewDataUrl(width = 180) {
    const canvas = document.createElement("canvas");
    const height = Math.round((width / DESIGN.width) * DESIGN.height);
    canvas.width = width;
    canvas.height = height;
    const previewCtx = canvas.getContext("2d");
    previewCtx.imageSmoothingEnabled = true;
    previewCtx.imageSmoothingQuality = "high";
    previewCtx.drawImage(artboard, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  }

  function init() {
    makePaperTexture();
    bindCanvasInteraction();
    bindInspector();
    bindHistoryAndShortcuts();
    document.getElementById("exportButton").addEventListener("click", exportPng);
    renderAll();

    let resizeFrame = 0;
    window.addEventListener("resize", () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(renderInspector);
    });

    window.__LUMEN_LIGHTBOX__ = {
      getState: () => cloneState(state),
      getReadabilityReport: readabilityReport,
      getSmallPreview: smallPreviewDataUrl,
      getExportDataUrl: () => artboard.toDataURL("image/png"),
      selectElement,
      undo,
      redo,
    };
  }

  init();
})();
