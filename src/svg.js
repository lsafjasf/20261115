import { UNFOLD_TREE } from "./geometry.js";

const A4_WIDTH = 210;
const A4_HEIGHT = 297;
const UNIT_MM = 20;
const HINGE_KEYS = new Set(
  UNFOLD_TREE.filter((step) => step.hinge).map((step) => {
    const [a, b] = step.hinge;
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }),
);

function number(value) {
  return Number(value.toFixed(3));
}

function pointsString(points) {
  return points.map(([x, y]) => `${number(x)},${number(y)}`).join(" ");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fitPattern(net) {
  const availableWidth = A4_WIDTH - 28;
  const availableHeight = A4_HEIGHT - 84;
  const scale = Math.min(
    UNIT_MM,
    availableWidth / Math.max(net.bounds.width, 0.1),
    availableHeight / Math.max(net.bounds.height, 0.1),
  );
  return {
    scale,
    x: (A4_WIDTH - net.bounds.width * scale) / 2 - net.bounds.minX * scale,
    y: 52 + (availableHeight - net.bounds.height * scale) / 2 - net.bounds.minY * scale,
  };
}

export function buildSvg(net, state) {
  const transform = fitPattern(net);
  const place = ([x, y]) => [x * transform.scale + transform.x, y * transform.scale + transform.y];
  const faceGroups = [];
  const tabGroups = [];
  const cutLines = [];
  const foldLines = [];
  const labels = [];
  const tabEdgeKeys = new Set(net.tabs.map((tab) => tab.edgeKey));
  const embeddedFont = state.embeddedFont
    ? `@font-face { font-family: "Foldwork CJK"; src: url("${state.embeddedFont}") format("woff2"); font-weight: 100 900; unicode-range: U+2E80-2EFF, U+3000-303F, U+31C0-31EF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF; }`
    : "";

  for (const tab of net.tabs) {
    const points = tab.polygon.map(place);
    tabGroups.push(
      `<polygon points="${pointsString(points)}" fill="url(#tabHatch)" stroke="none"/>`,
    );
    const outerPath = [points[1], points[2], points[3], points[0]]
      .map(([x, y]) => `${number(x)} ${number(y)}`)
      .join(" L ");
    cutLines.push(`<path d="M ${outerPath}"/>`);
  }

  for (const face of net.faces) {
    const points = face.polygon.map(place);
    faceGroups.push(
      `<polygon points="${pointsString(points)}" fill="${face.color}" fill-opacity="0.7" stroke="none"/>`,
    );
    for (let index = 0; index < face.vertexIds.length; index += 1) {
      const a = face.vertexIds[index];
      const b = face.vertexIds[(index + 1) % face.vertexIds.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const line = `M ${number(points[index][0])} ${number(points[index][1])} L ${
        number(points[(index + 1) % points.length][0])
      } ${number(points[(index + 1) % points.length][1])}`;
      if (HINGE_KEYS.has(key) || tabEdgeKeys.has(key)) foldLines.push(`<path d="${line}"/>`);
      else cutLines.push(`<path d="${line}"/>`);
    }
  }

  for (const face of net.faces) {
    const [x, y] = place(face.center);
    labels.push(`
      <g transform="translate(${number(x)} ${number(y)})">
        <rect x="-8" y="-5.6" width="16" height="11.2" rx="1.8" fill="#fffdf8" fill-opacity=".86" stroke="#829087" stroke-opacity=".4" stroke-width=".3"/>
        <text x="0" y="-1.1" text-anchor="middle" class="face-id">${escapeXml(face.id)}</text>
        <text x="0" y="3.7" text-anchor="middle" class="face-name">${escapeXml(face.name)}</text>
      </g>`);
  }

  if (state.showVertexLabels) {
    const seen = new Set();
    for (const face of net.faces) {
      face.vertexIds.forEach((id, index) => {
        if (seen.has(id)) return;
        seen.add(id);
        const [x, y] = place(face.polygon[index]);
        const selected = id === state.selectedVertex;
        labels.push(`
          <g transform="translate(${number(x)} ${number(y)})">
            <circle r="${selected ? 1.15 : 0.8}" fill="${selected ? "#e45f36" : "#fffdf8"}" stroke="${selected ? "#8f3820" : "#46655e"}" stroke-width=".35"/>
            <text x="1.8" y="-1.3" class="vertex-label" fill="${selected ? "#a24427" : "#46655e"}">V${id}</text>
          </g>`);
      });
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${A4_WIDTH}mm" height="${A4_HEIGHT}mm" viewBox="0 0 ${A4_WIDTH} ${A4_HEIGHT}" role="img" aria-labelledby="svgTitle svgDesc">
  <title id="svgTitle">六面体纸模展开图</title>
  <desc id="svgDesc">A4 可打印六面体展开图，包含 6 个面板、折线与 7 个粘贴舌片。</desc>
  <metadata>FOLDWORK · Papercraft Studio · Vertices V0-V7</metadata>
  <defs>
    <pattern id="tabHatch" width="2.1" height="2.1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="2.1" height="2.1" fill="#fbf6e8"/>
      <line x1="0" y1="0" x2="0" y2="2.1" stroke="#c9b992" stroke-width=".32" stroke-opacity=".62"/>
    </pattern>
    <style>
      ${embeddedFont}
      .mono { font-family: "DM Mono", "Foldwork CJK", "Courier New", monospace; }
      .sans { font-family: "Manrope", "Foldwork CJK", "Noto Sans SC", "Microsoft YaHei", sans-serif; }
      .face-id { font: 500 2.7px "DM Mono", "Courier New", monospace; fill: #3c5b54; }
      .face-name { font: 500 2.1px "Foldwork CJK", "Noto Sans SC", "Microsoft YaHei", sans-serif; fill: #627069; }
      .vertex-label { font: 500 2.2px "DM Mono", "Courier New", monospace; }
      .caption { font: 500 2.45px "DM Mono", "Foldwork CJK", "Courier New", monospace; fill: #8b928b; letter-spacing: .03em; }
      .title { font: 700 6.2px "Foldwork CJK", "Noto Sans SC", "Microsoft YaHei", sans-serif; fill: #17312f; letter-spacing: -.03em; }
      .subtitle { font: 500 2.3px "Foldwork CJK", "Noto Sans SC", "Microsoft YaHei", sans-serif; fill: #747e76; }
    </style>
  </defs>
  <rect width="${A4_WIDTH}" height="${A4_HEIGHT}" fill="#ffffff"/>
  <g class="sans">
    <text x="14" y="17" class="title">六面体纸模展开图</text>
    <text x="14" y="22.4" class="subtitle">8 顶点 · 6 面板 · ${net.tabs.length} 粘贴舌片 · 顶点编号锁定 V0—V7</text>
    <text x="196" y="14" text-anchor="end" class="caption">FOLDWORK / 01</text>
    <text x="196" y="19" text-anchor="end" class="caption">A4 · ${number(transform.scale)} mm / unit</text>
  </g>
  <path d="M14 29 H196" stroke="#d8d2c6" stroke-width=".45"/>
  <g id="tabs">${tabGroups.join("")}</g>
  <g id="panels">${faceGroups.join("")}</g>
  <g id="cut-lines" fill="none" stroke="#284943" stroke-width=".55" stroke-linecap="round" stroke-linejoin="round">${cutLines.join("")}</g>
  <g id="fold-lines" fill="none" stroke="#cf6842" stroke-width=".55" stroke-dasharray="1.7 1.25" stroke-linecap="round">${foldLines.join("")}</g>
  <g id="labels">${labels.join("")}</g>
  <g fill="none">
    <path d="M14 277 H29" stroke="#284943" stroke-width=".55"/>
    <path d="M14 282 H29" stroke="#cf6842" stroke-width=".55" stroke-dasharray="1.7 1.25"/>
    <rect x="14" y="285.5" width="15" height="3.4" fill="url(#tabHatch)" stroke="#284943" stroke-width=".35"/>
  </g>
  <g class="caption">
    <text x="33" y="278.2">CUT — 裁切线</text>
    <text x="33" y="283.2">FOLD — 折线</text>
    <text x="33" y="289.2">GLUE — 粘贴舌片</text>
    <text x="196" y="286" text-anchor="end">SCALE 1:1 · 100% PRINT</text>
    <text x="196" y="291" text-anchor="end">FOLDWORK PAPER SYSTEM</text>
  </g>
</svg>`;
}

export function downloadSvg(svg, filename = "foldwork-hexahedron.svg") {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}
