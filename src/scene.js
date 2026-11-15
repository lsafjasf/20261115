export const SCENE_VERSION = 1;
export const SCENE_SIZE = Object.freeze({ width: 960, height: 600 });
export const COORDINATE_THRESHOLD = 0.5;
export const COLOR_THRESHOLD = 2;

export const PALETTE = Object.freeze([
  "#5b5bd6",
  "#4545b8",
  "#ef7b5b",
  "#f2b84b",
  "#3f9b72",
  "#1d9ba8",
  "#d85d8e",
  "#7a4fb3",
  "#282d3c",
  "#f4f0e8"
]);

const DEFAULT_FONT = "Georgia, 'Times New Roman', serif";
const TYPE_NAMES = {
  rect: "Rectangle",
  circle: "Circle",
  path: "Path",
  text: "Text"
};

let idCounter = 0;

function nextId(type) {
  idCounter += 1;
  return `${type}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function solid(color) {
  return { type: "solid", color };
}

function linear(angle, stops) {
  return { type: "linear", angle, stops };
}

export function createScene(objects = [], options = {}) {
  const scene = {
    version: SCENE_VERSION,
    canvas: {
      width: options.width || SCENE_SIZE.width,
      height: options.height || SCENE_SIZE.height,
      background: options.background || "#f6f2ea"
    },
    objects: objects.map((object, index) => ({ ...object, z: index }))
  };
  return sanitizeScene(scene);
}

export function createRect(partial = {}) {
  return {
    id: nextId("rect"),
    type: "rect",
    name: "Rectangle",
    x: 100,
    y: 100,
    width: 180,
    height: 120,
    radius: 12,
    fill: solid(PALETTE[0]),
    stroke: { color: "#282d3c", width: 0 },
    opacity: 1,
    ...partial
  };
}

export function createCircle(partial = {}) {
  return {
    id: nextId("circle"),
    type: "circle",
    name: "Circle",
    x: 300,
    y: 250,
    r: 70,
    fill: solid(PALETTE[2]),
    stroke: { color: "#282d3c", width: 0 },
    opacity: 1,
    ...partial
  };
}

export function createPath(partial = {}) {
  return {
    id: nextId("path"),
    type: "path",
    name: "Path",
    points: [
      { x: 100, y: 200 },
      { x: 170, y: 120 },
      { x: 240, y: 210 }
    ],
    closed: false,
    fill: null,
    stroke: { color: PALETTE[7], width: 3 },
    opacity: 1,
    ...partial
  };
}

export function createText(partial = {}) {
  return {
    id: nextId("text"),
    type: "text",
    name: "Text",
    x: 120,
    y: 160,
    text: "Editable text",
    fontFamily: DEFAULT_FONT,
    fontSize: 45,
    fontWeight: 500,
    align: "left",
    fill: solid("#282d3c"),
    stroke: { color: "#282d3c", width: 0 },
    opacity: 1,
    ...partial
  };
}

export function duplicateObject(object) {
  const copy = JSON.parse(JSON.stringify(object));
  copy.id = nextId(object.type);
  copy.name = `${object.name} copy`;
  if (["rect", "circle"].includes(copy.type)) {
    copy.x += 18;
    copy.y += 18;
  } else if (copy.type === "path") {
    copy.points = copy.points.map((point) => ({ x: point.x + 18, y: point.y + 18 }));
  } else if (copy.type === "text") {
    copy.x += 18;
    copy.y += 18;
  }
  return copy;
}

function assertFinite(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function sanitizePaint(paint, label) {
  if (paint == null) return null;
  if (!paint || !["solid", "linear"].includes(paint.type)) {
    throw new Error(`${label} has an unsupported paint type`);
  }
  if (paint.type === "solid") {
    if (typeof paint.color !== "string" || !paint.color) {
      throw new Error(`${label}.color is required`);
    }
    return { type: "solid", color: paint.color };
  }
  if (!Array.isArray(paint.stops) || paint.stops.length < 2) {
    throw new Error(`${label}.stops must contain at least two colors`);
  }
  assertFinite(paint.angle, `${label}.angle`);
  return {
    type: "linear",
    angle: paint.angle,
    stops: paint.stops.map((stop, index) => {
      assertFinite(stop.offset, `${label}.stops[${index}].offset`);
      if (typeof stop.color !== "string" || !stop.color) {
        throw new Error(`${label}.stops[${index}].color is required`);
      }
      return { offset: stop.offset, color: stop.color };
    })
  };
}

function sanitizeStroke(stroke, label) {
  if (stroke == null) return null;
  if (typeof stroke.color !== "string") {
    throw new Error(`${label}.color is required`);
  }
  assertFinite(stroke.width, `${label}.width`);
  return { color: stroke.color, width: stroke.width };
}

function sanitizeObject(object, index) {
  if (!object || typeof object !== "object") {
    throw new Error(`objects[${index}] must be an object`);
  }
  if (!["rect", "circle", "path", "text"].includes(object.type)) {
    throw new Error(`objects[${index}] has unsupported type "${object.type}"`);
  }
  if (typeof object.id !== "string" || !object.id) {
    throw new Error(`objects[${index}].id is required`);
  }

  const base = {
    id: object.id,
    type: object.type,
    name: object.name || TYPE_NAMES[object.type],
    z: object.z,
    opacity: object.opacity ?? 1,
    fill: sanitizePaint(object.fill, `objects[${index}].fill`),
    stroke: sanitizeStroke(object.stroke, `objects[${index}].stroke`)
  };
  assertFinite(base.z, `objects[${index}].z`);
  assertFinite(base.opacity, `objects[${index}].opacity`);

  if (object.type === "rect") {
    for (const key of ["x", "y", "width", "height", "radius"]) {
      assertFinite(object[key], `objects[${index}].${key}`);
    }
    if (object.width <= 0 || object.height <= 0) {
      throw new Error(`objects[${index}] must have a positive size`);
    }
    return {
      ...base,
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      radius: Math.max(0, object.radius)
    };
  }

  if (object.type === "circle") {
    for (const key of ["x", "y", "r"]) {
      assertFinite(object[key], `objects[${index}].${key}`);
    }
    if (object.r <= 0) throw new Error(`objects[${index}].r must be positive`);
    return { ...base, x: object.x, y: object.y, r: object.r };
  }

  if (object.type === "path") {
    if (!Array.isArray(object.points) || object.points.length < 2) {
      throw new Error(`objects[${index}].points must contain at least two points`);
    }
    const points = object.points.map((point, pointIndex) => {
      assertFinite(point.x, `objects[${index}].points[${pointIndex}].x`);
      assertFinite(point.y, `objects[${index}].points[${pointIndex}].y`);
      return { x: point.x, y: point.y };
    });
    return { ...base, points, closed: Boolean(object.closed) };
  }

  if (typeof object.text !== "string") {
    throw new Error(`objects[${index}].text must be a string`);
  }
  for (const key of ["x", "y", "fontSize", "fontWeight"]) {
    assertFinite(object[key], `objects[${index}].${key}`);
  }
  if (!["left", "center", "right"].includes(object.align || "left")) {
    throw new Error(`objects[${index}].align is invalid`);
  }
  return {
    ...base,
    x: object.x,
    y: object.y,
    text: object.text,
    fontFamily: object.fontFamily || DEFAULT_FONT,
    fontSize: object.fontSize,
    fontWeight: object.fontWeight,
    align: object.align || "left"
  };
}

export function sanitizeScene(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Scene JSON must be an object");
  }
  if (input.version !== SCENE_VERSION) {
    throw new Error(`Unsupported scene version: ${input.version}`);
  }
  const canvas = input.canvas || {};
  for (const key of ["width", "height"]) {
    assertFinite(canvas[key], `canvas.${key}`);
    if (canvas[key] <= 0) throw new Error(`canvas.${key} must be positive`);
  }
  if (!Array.isArray(input.objects)) {
    throw new Error("Scene objects must be an array");
  }

  const ids = new Set();
  const objects = input.objects
    .map((object, index) => sanitizeObject(object, index))
    .sort((a, b) => a.z - b.z)
    .map((object, index) => ({ ...object, z: index }));

  for (const object of objects) {
    if (ids.has(object.id)) throw new Error(`Duplicate object id: ${object.id}`);
    ids.add(object.id);
  }

  return {
    version: SCENE_VERSION,
    canvas: {
      width: canvas.width,
      height: canvas.height,
      background: canvas.background || "#ffffff"
    },
    objects
  };
}

export function sceneFromJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON");
  }
  return sanitizeScene(parsed);
}

export function sceneToJSON(scene) {
  return JSON.stringify(sanitizeScene(scene), null, 2);
}

export function withZOrder(scene) {
  return {
    ...scene,
    objects: scene.objects.map((object, index) => ({ ...object, z: index }))
  };
}

function hashSeed(seed) {
  const text = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function randomFill(random, allowEmpty = false) {
  if (allowEmpty && random() < 0.3) return null;
  if (random() < 0.5) {
    return solid(randomPick(random, PALETTE));
  }
  const first = randomPick(random, PALETTE);
  let second = randomPick(random, PALETTE);
  if (second === first) second = PALETTE[(PALETTE.indexOf(first) + 3) % PALETTE.length];
  return linear(Math.floor(random() * 360), [
    { offset: 0, color: first },
    { offset: rounded(0.35 + random() * 0.3), color: randomPick(random, PALETTE) },
    { offset: 1, color: second }
  ]);
}

function randomStroke(random, includeEmpty = true) {
  if (includeEmpty && random() < 0.38) {
    return { color: "#282d3c", width: 0 };
  }
  return {
    color: randomPick(random, PALETTE),
    width: rounded(1 + random() * 5)
  };
}

export function generateRandomScene(seed = "vectra-demo", count = 18) {
  const random = seededRandom(seed);
  const objects = [];
  const objectTypes = ["rect", "circle", "path", "text"];
  let id = 0;

  while (objects.length < count) {
    const type = objectTypes[objects.length % objectTypes.length];
    id += 1;
    if (type === "rect") {
      objects.push({
        ...createRect(),
        id: `rect-${id}`,
        name: `Panel ${String(id).padStart(2, "0")}`,
        x: rounded(35 + random() * 730),
        y: rounded(35 + random() * 415),
        width: rounded(75 + random() * 245),
        height: rounded(55 + random() * 170),
        radius: rounded(random() < 0.5 ? random() * 20 : 0),
        fill: randomFill(random),
        stroke: randomStroke(random),
        opacity: rounded(0.68 + random() * 0.32)
      });
    } else if (type === "circle") {
      objects.push({
        ...createCircle(),
        id: `circle-${id}`,
        name: `Orb ${String(id).padStart(2, "0")}`,
        x: rounded(70 + random() * 820),
        y: rounded(70 + random() * 460),
        r: rounded(20 + random() * 72),
        fill: randomFill(random),
        stroke: randomStroke(random),
        opacity: rounded(0.68 + random() * 0.32)
      });
    } else if (type === "path") {
      const startX = 40 + random() * 700;
      const startY = 70 + random() * 360;
      const points = [{ x: rounded(startX), y: rounded(startY) }];
      const pointCount = 3 + Math.floor(random() * 5);
      for (let pointIndex = 1; pointIndex < pointCount; pointIndex += 1) {
        points.push({
          x: rounded(startX + (pointIndex * 35) + random() * 55),
          y: rounded(Math.max(30, Math.min(560, startY + (random() - 0.5) * 130)))
        });
      }
      objects.push({
        ...createPath(),
        id: `path-${id}`,
        name: `Curve ${String(id).padStart(2, "0")}`,
        points,
        closed: random() < 0.35,
        fill: randomFill(random, true),
        stroke: {
          color: randomPick(random, PALETTE),
          width: rounded(1 + random() * 5)
        },
        opacity: rounded(0.68 + random() * 0.32)
      });
    } else {
      const labels = [
        "Compose",
        "Vector",
        "Form & Flow",
        "Editable",
        "Studio",
        "Moment",
        "Layer",
        "Contrast"
      ];
      objects.push({
        ...createText(),
        id: `text-${id}`,
        name: `Type ${String(id).padStart(2, "0")}`,
        x: rounded(45 + random() * 650),
        y: rounded(55 + random() * 440),
        text: randomPick(random, labels),
        fontSize: rounded(24 + random() * 42),
        fontWeight: randomPick(random, [400, 500, 600, 700]),
        align: randomPick(random, ["left", "center", "right"]),
        fill: randomFill(random),
        stroke: randomStroke(random),
        opacity: rounded(0.72 + random() * 0.28)
      });
    }
  }

  return createScene(objects);
}

export function createStarterScene() {
  return createScene([
    {
      ...createRect(),
      id: "rect-panel-primary",
      name: "Gradient panel",
      x: 58,
      y: 72,
      width: 274,
      height: 184,
      radius: 22,
      fill: linear(35, [
        { offset: 0, color: "#5b5bd6" },
        { offset: 0.55, color: "#7a4fb3" },
        { offset: 1, color: "#ef7b5b" }
      ]),
      stroke: { color: "#282d3c", width: 0 }
    },
    {
      ...createCircle(),
      id: "circle-sun",
      name: "Warm orb",
      x: 720,
      y: 178,
      r: 128,
      fill: linear(125, [
        { offset: 0, color: "#f2b84b" },
        { offset: 0.52, color: "#ef7b5b" },
        { offset: 1, color: "#d85d8e" }
      ]),
      stroke: { color: "#282d3c", width: 0 },
      opacity: 0.96
    },
    {
      ...createRect(),
      id: "rect-type-field",
      name: "Type field",
      x: 364,
      y: 316,
      width: 430,
      height: 205,
      radius: 27,
      fill: solid("#282d3c"),
      stroke: { color: "#282d3c", width: 0 },
      opacity: 0.98
    },
    {
      ...createPath(),
      id: "path-flow",
      name: "Flow line",
      points: [
        { x: 76, y: 466 },
        { x: 148, y: 398 },
        { x: 226, y: 486 },
        { x: 318, y: 416 },
        { x: 392, y: 488 }
      ],
      closed: false,
      fill: null,
      stroke: { color: "#3f9b72", width: 7 }
    },
    {
      ...createCircle(),
      id: "circle-accent",
      name: "Green accent",
      x: 474,
      y: 188,
      r: 50,
      fill: solid("#3f9b72"),
      stroke: { color: "#282d3c", width: 0 }
    },
    {
      ...createText(),
      id: "text-hero",
      name: "Hero type",
      x: 396,
      y: 344,
      text: "Make\nit visible.",
      fontSize: 56,
      fontWeight: 500,
      align: "left",
      fill: solid("#fbfaf7"),
      stroke: { color: "#fbfaf7", width: 0 }
    },
    {
      ...createRect(),
      id: "rect-rule",
      name: "Accent rule",
      x: 58,
      y: 286,
      width: 126,
      height: 9,
      radius: 5,
      fill: solid("#3f9b72"),
      stroke: { color: "#3f9b72", width: 0 }
    },
    {
      ...createText(),
      id: "text-caption",
      name: "Caption",
      x: 60,
      y: 544,
      text: "VECTRA / COMPOSITION 01",
      fontSize: 15,
      fontWeight: 700,
      align: "left",
      fill: solid("#5b5bd6"),
      stroke: { color: "#5b5bd6", width: 0 }
    }
  ]);
}

function compareNumbers(left, right) {
  return Math.abs(left - right);
}

function colorChannels(color) {
  const match = /^#([0-9a-f]{6})$/i.exec(color || "");
  if (!match) return [128, 128, 128];
  const value = match[1];
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16)
  ];
}

function paintColors(paint, colors) {
  if (!paint) return;
  if (paint.type === "solid") {
    colors.push(paint.color);
  } else {
    paint.stops.forEach((stop) => colors.push(stop.color));
  }
}

function objectCoordinates(object, coordinates) {
  if (object.type === "rect") {
    coordinates.push(object.x, object.y, object.width, object.height, object.radius);
  } else if (object.type === "circle") {
    coordinates.push(object.x, object.y, object.r);
  } else if (object.type === "path") {
    object.points.forEach((point) => coordinates.push(point.x, point.y));
  } else {
    coordinates.push(object.x, object.y, object.fontSize, object.fontWeight);
  }
  coordinates.push(object.stroke?.width || 0, object.opacity);
}

export function compareScenes(original, restored) {
  const maxCoordinateDelta = Math.max(
    0,
    ...compareCoordinates(original, restored)
  );
  const maxColorDelta = maxColorDistance(original, restored);
  const orderMatches =
    original.objects.length === restored.objects.length &&
    original.objects.every((object, index) => {
      const other = restored.objects[index];
      return object.id === other.id && object.z === index && other.z === index;
    });
  const typesMatch =
    original.objects.length === restored.objects.length &&
    original.objects.every((object, index) => object.type === restored.objects[index].type);

  return {
    objectCountOriginal: original.objects.length,
    objectCountRestored: restored.objects.length,
    objectCountMatches: original.objects.length === restored.objects.length,
    typesMatch,
    zOrderMatches: orderMatches,
    maxCoordinateDelta,
    maxColorDelta,
    coordinateThreshold: COORDINATE_THRESHOLD,
    colorThreshold: COLOR_THRESHOLD,
    passed:
      original.objects.length === restored.objects.length &&
      typesMatch &&
      orderMatches &&
      maxCoordinateDelta <= COORDINATE_THRESHOLD &&
      maxColorDelta <= COLOR_THRESHOLD
  };
}

function compareCoordinates(original, restored) {
  const left = [];
  const right = [];
  objectCoordinatesPair(original, restored, left, right);
  return left.map((value, index) => compareNumbers(value, right[index]));
}

function objectCoordinatesPair(original, restored, left, right) {
  const byId = new Map(original.objects.map((object) => [object.id, object]));
  restored.objects.forEach((object) => {
    const other = byId.get(object.id);
    if (!other || other.type !== object.type) return;
    objectCoordinates(other, left);
    objectCoordinates(object, right);
  });
}

function maxColorDistance(original, restored) {
  const originalColors = [];
  const restoredColors = [];
  original.objects.forEach((object) => {
    paintColors(object.fill, originalColors);
    if (object.stroke) originalColors.push(object.stroke.color);
  });
  restored.objects.forEach((object) => {
    paintColors(object.fill, restoredColors);
    if (object.stroke) restoredColors.push(object.stroke.color);
  });
  let maximum = 0;
  originalColors.forEach((color, index) => {
    const left = colorChannels(color);
    const right = colorChannels(restoredColors[index]);
    maximum = Math.max(maximum, ...left.map((value, channel) => Math.abs(value - right[channel])));
  });
  return maximum;
}
