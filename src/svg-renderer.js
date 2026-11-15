import { gradientLine, objectBounds, pathToData, round } from "./geometry.js";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function textBounds(object) {
  const width = Math.max(
    1,
    ...object.text.split("\n").map((line) => line.length * object.fontSize * 0.54)
  );
  const height = Math.max(object.fontSize, object.text.split("\n").length * object.fontSize * 1.22);
  return objectBounds(object, { width, height });
}

function paintReference(paint, bounds, objectId, definitions) {
  if (!paint) return null;
  if (paint.type === "solid") return paint.color;
  const id = `gradient-${safeId(objectId)}`;
  const line = gradientLine(bounds, paint.angle);
  const stops = paint.stops
    .slice()
    .sort((left, right) => left.offset - right.offset)
    .map(
      (stop) =>
        `<stop offset="${round(stop.offset)}" stop-color="${escapeXml(stop.color)}"/>`
    )
    .join("");
  definitions.push(
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${round(line.x1)}" y1="${round(line.y1)}" x2="${round(line.x2)}" y2="${round(line.y2)}">${stops}</linearGradient>`
  );
  return `url(#${id})`;
}

function commonAttributes(object, paint, bounds, definitions) {
  const fill = paintReference(paint, bounds, object.id, definitions);
  const attributes = [
    `id="${escapeXml(object.id)}"`,
    `data-name="${escapeXml(object.name || object.type)}"`,
    `fill="${fill ? escapeXml(fill) : "none"}"`,
    `opacity="${round(object.opacity ?? 1)}"`
  ];
  if (object.stroke?.width > 0) {
    attributes.push(`stroke="${escapeXml(object.stroke.color)}"`);
    attributes.push(`stroke-width="${round(object.stroke.width)}"`);
    attributes.push('stroke-linejoin="round"');
    attributes.push('stroke-linecap="round"');
  }
  return attributes.join(" ");
}

function renderRect(object, definitions) {
  const bounds = objectBounds(object);
  const attributes = commonAttributes(object, object.fill, bounds, definitions);
  return `<rect ${attributes} x="${round(object.x)}" y="${round(object.y)}" width="${round(object.width)}" height="${round(object.height)}" rx="${round(object.radius || 0)}"/>`;
}

function renderCircle(object, definitions) {
  const bounds = objectBounds(object);
  const attributes = commonAttributes(object, object.fill, bounds, definitions);
  return `<circle ${attributes} cx="${round(object.x)}" cy="${round(object.y)}" r="${round(object.r)}"/>`;
}

function renderPath(object, definitions) {
  const bounds = objectBounds(object);
  const attributes = commonAttributes(object, object.fill, bounds, definitions);
  return `<path ${attributes} d="${pathToData(object)}"/>`;
}

function renderText(object, definitions) {
  const bounds = textBounds(object);
  const attributes = commonAttributes(object, object.fill, bounds, definitions);
  const anchor = { left: "start", center: "middle", right: "end" }[object.align || "left"];
  const lineHeight = object.fontSize * 1.22;
  const lines = object.text.split("\n");
  const spans = lines
    .map((line, index) => {
      return `<tspan x="${round(object.x)}" y="${round(object.y + index * lineHeight)}">${escapeXml(line)}</tspan>`;
    })
    .join("");
  return `<text ${attributes} x="${round(object.x)}" y="${round(object.y)}" font-family="${escapeXml(object.fontFamily)}" font-size="${round(object.fontSize)}" font-weight="${round(object.fontWeight)}" text-anchor="${anchor}" dominant-baseline="text-before-edge" xml:space="preserve">${spans}</text>`;
}

export function sceneToSVG(scene) {
  const definitions = [];
  const body = scene.objects
    .map((object) => {
      if (object.type === "rect") return renderRect(object, definitions);
      if (object.type === "circle") return renderCircle(object, definitions);
      if (object.type === "path") return renderPath(object, definitions);
      return renderText(object, definitions);
    })
    .join("\n  ");

  const definitionBlock = definitions.length
    ? `\n  <defs>\n    ${definitions.join("\n    ")}\n  </defs>`
    : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(scene.canvas.width)}" height="${round(scene.canvas.height)}" viewBox="0 0 ${round(scene.canvas.width)} ${round(scene.canvas.height)}" role="img" aria-label="Vectra vector scene">`,
    `  <title>Vectra scene</title>${definitionBlock}`,
    `  <rect width="${round(scene.canvas.width)}" height="${round(scene.canvas.height)}" fill="${escapeXml(scene.canvas.background)}"/>`,
    `  ${body}`,
    "</svg>"
  ].join("\n");
}
