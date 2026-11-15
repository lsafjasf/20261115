import {
  FACE_VERTICES,
  add,
  cross,
  dot,
  getFaceVertices3D,
  normalize,
  scale,
  sub,
} from "./geometry.js";

const FONT = '"Foldwork CJK", "Avenir Next", "Ubuntu Sans", sans-serif';
const MONO = '"Foldwork CJK", "SFMono-Regular", "Ubuntu Mono", monospace';

export function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: rect.width, height: rect.height };
}

export function makeCamera(width, height, yaw, pitch, zoom) {
  const cosineYaw = Math.cos(yaw);
  const sineYaw = Math.sin(yaw);
  const cosinePitch = Math.cos(pitch);
  const sinePitch = Math.sin(pitch);
  const eye = [sineYaw * cosinePitch, sinePitch, cosineYaw * cosinePitch];
  const right = [cosineYaw, 0, -sineYaw];
  const up = [-sinePitch * sineYaw, cosinePitch, -sinePitch * cosineYaw];
  const scaleValue = Math.min(width, height) * 0.176 * zoom;
  const center = [width / 2, height / 2 + 12];

  return {
    eye,
    right,
    up,
    scale: scaleValue,
    center,
    project(point) {
      return [
        center[0] + dot(point, right) * scaleValue,
        center[1] - dot(point, up) * scaleValue,
        dot(point, eye),
      ];
    },
    screenDeltaToWorld(dx, dy) {
      return add(scale(right, dx / scaleValue), scale(up, -dy / scaleValue));
    },
  };
}

function toRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function tracePolygon(context, polygon) {
  context.beginPath();
  polygon.forEach(([x, y], index) => {
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function faceLight(facePoints, eye) {
  const normal = normalize(cross(
    sub(facePoints[1], facePoints[0]),
    sub(facePoints[2], facePoints[0]),
  ));
  return Math.max(0.48, Math.min(1, 0.72 + Math.abs(dot(normal, eye)) * 0.3));
}

function drawModelFloor(context, width, height, camera) {
  const floorY = -0.98;
  const center = camera.project([0, floorY, 0]);
  const edge = camera.project([1.65, floorY, 0]);
  const radiusX = Math.abs(edge[0] - center[0]);
  const radiusY = radiusX * 0.27;
  const gradient = context.createRadialGradient(
    center[0],
    center[1],
    5,
    center[0],
    center[1],
    radiusX,
  );
  gradient.addColorStop(0, "rgba(56, 71, 60, 0.13)");
  gradient.addColorStop(0.65, "rgba(56, 71, 60, 0.055)");
  gradient.addColorStop(1, "rgba(56, 71, 60, 0)");
  context.save();
  context.translate(center[0], center[1]);
  context.scale(1, radiusY / Math.max(radiusX, 1));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, radiusX, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function renderModel(context, width, height, state) {
  context.clearRect(0, 0, width, height);
  const camera = makeCamera(width, height, state.yaw, state.pitch, state.zoom);
  drawModelFloor(context, width, height, camera);

  const projected = Object.fromEntries(
    state.vertices.map((vertex) => [vertex.id, camera.project(vertex.position)]),
  );
  const renderedFaces = state.faces.map((face) => {
    const points3D = getFaceVertices3D(state.vertices, face.id);
    const points2D = FACE_VERTICES[face.id].map((id) => projected[id]);
    return {
      ...face,
      points3D,
      points2D,
      depth: points3D.reduce((sum, point) => sum + dot(point, camera.eye), 0) / 4,
      light: faceLight(points3D, camera.eye),
    };
  });

  renderedFaces.sort((first, second) => first.depth - second.depth);
  for (const face of renderedFaces) {
    const selectedFace = FACE_VERTICES[face.id].includes(state.selectedVertex) ||
      FACE_VERTICES[face.id].includes(state.hoverVertex);
    tracePolygon(context, face.points2D);
    context.fillStyle = toRgba(face.color, face.id === "F2" ? 0.9 : 0.84);
    context.fill();
    context.strokeStyle = selectedFace ? "#9f563e" : "#36524d";
    context.lineWidth = selectedFace ? 1.3 : 1.05;
    context.stroke();

    const center = face.points2D.reduce(
      (sum, point) => [sum[0] + point[0] / 4, sum[1] + point[1] / 4],
      [0, 0],
    );
    context.save();
    context.font = `500 8px ${MONO}`;
    context.fillStyle = "rgba(23, 49, 47, 0.48)";
    context.textAlign = "center";
    context.fillText(face.id, center[0], center[1] + 3);
    context.restore();
  }

  const allEdges = new Set();
  const edgeSegments = [];
  for (const face of state.faces) {
    const ids = FACE_VERTICES[face.id];
    for (let index = 0; index < ids.length; index += 1) {
      const a = ids[index];
      const b = ids[(index + 1) % ids.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (allEdges.has(key)) continue;
      allEdges.add(key);
      edgeSegments.push([projected[a], projected[b], a, b]);
    }
  }

  context.strokeStyle = "rgba(29, 62, 56, 0.74)";
  context.lineWidth = 1.15;
  for (const [a, b] of edgeSegments) {
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.stroke();
  }

  const center3D = [0, 0, 0];
  const screenCenter = camera.project(center3D);
  const vertexDepth = state.vertices
    .map((vertex) => ({ vertex, point: projected[vertex.id] }))
    .sort((first, second) => first.point[2] - second.point[2]);

  for (const { vertex, point } of vertexDepth) {
    const isSelected = vertex.id === state.selectedVertex;
    const isHovered = vertex.id === state.hoverVertex;
    const outward = normalize(sub([point[0], point[1], 0], [screenCenter[0], screenCenter[1], 0]));
    const labelX = point[0] + (outward[0] || 0.4) * 14;
    const labelY = point[1] + (outward[1] || -0.4) * 14;

    if (isSelected || isHovered) {
      context.beginPath();
      context.arc(point[0], point[1], isSelected ? 12 : 10, 0, Math.PI * 2);
      context.fillStyle = isSelected ? "rgba(228, 95, 54, 0.13)" : "rgba(43, 106, 99, 0.12)";
      context.fill();
    }

    context.beginPath();
    context.arc(point[0], point[1], isSelected ? 5.5 : 4.6, 0, Math.PI * 2);
    context.fillStyle = isSelected ? "#e45f36" : "#fffdf8";
    context.strokeStyle = isSelected ? "#8f3820" : "#315c55";
    context.lineWidth = isSelected ? 1.5 : 1.2;
    context.fill();
    context.stroke();

    context.save();
    context.font = `${isSelected ? 500 : 400} 7px ${MONO}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = isSelected ? "#9f3d22" : isHovered ? "#315c55" : "#5b716b";
    context.fillText(`V${vertex.id}`, labelX, labelY);
    context.restore();
  }
}

export function hitTestModel(x, y, state, width, height) {
  const camera = makeCamera(width, height, state.yaw, state.pitch, state.zoom);
  let closest = null;
  let closestDistance = 15;
  for (const vertex of state.vertices) {
    const point = camera.project(vertex.position);
    const distance = Math.hypot(point[0] - x, point[1] - y);
    if (distance < closestDistance) {
      closest = vertex.id;
      closestDistance = distance;
    }
  }
  return closest;
}

export function screenToVertexDelta(dx, dy, state, width, height) {
  return makeCamera(width, height, state.yaw, state.pitch, state.zoom).screenDeltaToWorld(dx, dy);
}

function fitNetTransform(net, width, height) {
  const horizontalPadding = Math.max(28, Math.min(64, width * 0.075));
  const verticalPadding = Math.max(40, Math.min(78, height * 0.12));
  const availableWidth = Math.max(1, width - horizontalPadding * 2);
  const availableHeight = Math.max(1, height - verticalPadding * 2);
  const fit = Math.min(
    availableWidth / Math.max(net.bounds.width, 0.1),
    availableHeight / Math.max(net.bounds.height, 0.1),
  );
  return {
    scale: fit,
    x: (width - net.bounds.width * fit) / 2 - net.bounds.minX * fit,
    y: (height - net.bounds.height * fit) / 2 - net.bounds.minY * fit,
  };
}

function netPoint(point, transform) {
  return [point[0] * transform.scale + transform.x, point[1] * transform.scale + transform.y];
}

function drawSheet(context, width, height) {
  context.save();
  context.shadowColor = "rgba(72, 62, 44, 0.13)";
  context.shadowBlur = 20;
  context.shadowOffsetY = 7;
  roundedRect(context, 17, 15, width - 34, height - 30, 3);
  context.fillStyle = "#fffdf7";
  context.fill();
  context.restore();

  context.strokeStyle = "rgba(190, 181, 160, 0.46)";
  context.lineWidth = 1;
  roundedRect(context, 17.5, 15.5, width - 35, height - 31, 3);
  context.stroke();

  context.save();
  context.strokeStyle = "rgba(135, 139, 126, 0.35)";
  context.lineWidth = 0.7;
  const mark = 7;
  const corners = [
    [29, 27, 1, 1],
    [width - 29, 27, -1, 1],
    [29, height - 27, 1, -1],
    [width - 29, height - 27, -1, -1],
  ];
  for (const [x, y, directionX, directionY] of corners) {
    context.beginPath();
    context.moveTo(x, y + directionY * mark);
    context.lineTo(x, y);
    context.lineTo(x + directionX * mark, y);
    context.stroke();
  }
  context.restore();
}

function traceTab(context, tab, transform) {
  context.beginPath();
  tab.polygon.forEach((point, index) => {
    const [x, y] = netPoint(point, transform);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
}

function drawTabHatch(context, tab, transform) {
  const points = tab.polygon.map((point) => netPoint(point, transform));
  const minX = Math.min(...points.map((point) => point[0])) - 2;
  const maxX = Math.max(...points.map((point) => point[0])) + 2;
  const minY = Math.min(...points.map((point) => point[1])) - 2;
  const maxY = Math.max(...points.map((point) => point[1])) + 2;
  context.save();
  traceTab(context, tab, transform);
  context.clip();
  context.strokeStyle = "rgba(170, 153, 119, 0.35)";
  context.lineWidth = 0.65;
  for (let offset = minX - (maxY - minY); offset < maxX + (maxY - minY); offset += 6) {
    context.beginPath();
    context.moveTo(offset, maxY);
    context.lineTo(offset + (maxY - minY), minY);
    context.stroke();
  }
  context.restore();
}

function drawNetEdge(context, pointA, pointB, transform, type) {
  const [ax, ay] = netPoint(pointA, transform);
  const [bx, by] = netPoint(pointB, transform);
  context.beginPath();
  context.moveTo(ax, ay);
  context.lineTo(bx, by);
  if (type === "fold") {
    context.strokeStyle = "#cf6842";
    context.lineWidth = 1.05;
    context.setLineDash([4.5, 3.4]);
  } else {
    context.strokeStyle = "#284943";
    context.lineWidth = 1.2;
    context.setLineDash([]);
  }
  context.stroke();
  context.setLineDash([]);
}

export function renderNet(context, width, height, net, state) {
  context.clearRect(0, 0, width, height);
  drawSheet(context, width, height);
  const transform = fitNetTransform(net, width, height);

  for (const tab of net.tabs) {
    traceTab(context, tab, transform);
    context.fillStyle = "#fbf6e8";
    context.fill();
    drawTabHatch(context, tab, transform);
  }

  for (const face of net.faces) {
    tracePolygon(context, face.polygon.map((point) => netPoint(point, transform)));
    context.fillStyle = toRgba(face.color, 0.71);
    context.fill();
  }

  const foldEdgeKeys = new Set();
  for (const face of net.faces) {
    for (let index = 0; index < face.vertexIds.length; index += 1) {
      const a = face.vertexIds[index];
      const b = face.vertexIds[(index + 1) % face.vertexIds.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (face.polygon.length && isHingeKey(a, b)) foldEdgeKeys.add(key);
    }
  }
  const tabEdgeKeys = new Set(net.tabs.map((tab) => tab.edgeKey));

  for (const face of net.faces) {
    for (let index = 0; index < face.vertexIds.length; index += 1) {
      const a = face.vertexIds[index];
      const b = face.vertexIds[(index + 1) % face.vertexIds.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (foldEdgeKeys.has(key) || tabEdgeKeys.has(key)) continue;
      drawNetEdge(
        context,
        face.polygon[index],
        face.polygon[(index + 1) % face.polygon.length],
        transform,
        "cut",
      );
    }
  }

  for (const face of net.faces) {
    for (let index = 0; index < face.vertexIds.length; index += 1) {
      const a = face.vertexIds[index];
      const b = face.vertexIds[(index + 1) % face.vertexIds.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!foldEdgeKeys.has(key) && !tabEdgeKeys.has(key)) continue;
      drawNetEdge(
        context,
        face.polygon[index],
        face.polygon[(index + 1) % face.polygon.length],
        transform,
        "fold",
      );
    }
  }

  for (const tab of net.tabs) {
    const points = tab.polygon.map((point) => netPoint(point, transform));
    context.beginPath();
    context.moveTo(points[1][0], points[1][1]);
    context.lineTo(points[2][0], points[2][1]);
    context.lineTo(points[3][0], points[3][1]);
    context.lineTo(points[0][0], points[0][1]);
    context.strokeStyle = "#284943";
    context.lineWidth = 1.1;
    context.setLineDash([]);
    context.stroke();
  }

  for (const face of net.faces) {
    const [cx, cy] = netPoint(face.center, transform);
    const isSelected = state.selectedVertex != null &&
      FACE_VERTICES[face.id].includes(state.selectedVertex);
    context.save();
    context.translate(cx, cy);
    roundedRect(context, -19, -14, 38, 28, 4);
    context.fillStyle = isSelected ? "rgba(255, 251, 242, 0.94)" : "rgba(255, 253, 248, 0.76)";
    context.fill();
    context.strokeStyle = isSelected ? "rgba(207, 104, 66, 0.76)" : "rgba(94, 104, 91, 0.25)";
    context.lineWidth = 0.8;
    context.stroke();
    context.font = `500 8px ${MONO}`;
    context.fillStyle = "#3c5b54";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(face.id, 0, -4);
    context.font = `500 7px ${FONT}`;
    context.fillStyle = "rgba(72, 86, 79, 0.72)";
    context.fillText(face.name, 0, 7);
    context.restore();
  }

  if (state.showVertexLabels) {
    const seen = new Set();
    for (const face of net.faces) {
      face.vertexIds.forEach((id, index) => {
        if (seen.has(id)) return;
        seen.add(id);
        const [x, y] = netPoint(face.polygon[index], transform);
        const isSelected = id === state.selectedVertex;
        context.beginPath();
        context.arc(x, y, isSelected ? 3.4 : 2.4, 0, Math.PI * 2);
        context.fillStyle = isSelected ? "#e45f36" : "#fffdf8";
        context.strokeStyle = isSelected ? "#9f3e23" : "#46655e";
        context.lineWidth = 0.9;
        context.fill();
        context.stroke();
        context.save();
        context.font = `${isSelected ? 500 : 400} 7px ${MONO}`;
        context.fillStyle = isSelected ? "#a24427" : "rgba(70, 101, 94, 0.68)";
        context.textAlign = "left";
        context.textBaseline = "bottom";
        context.fillText(`V${id}`, x + 5, y - 3);
        context.restore();
      });
    }
  }

  context.save();
  context.font = `500 7px ${MONO}`;
  context.fillStyle = "rgba(99, 108, 96, 0.55)";
  context.textAlign = "left";
  context.fillText("HEXAHEDRON / FOLDWORK 01", 29, height - 24);
  context.textAlign = "right";
  context.fillText("SCALE 1:1 · A4", width - 29, height - 24);
  context.restore();
}

const HINGE_KEYS = new Set([
  "0:1",
  "1:2",
  "2:3",
  "0:3",
  "6:7",
]);

function isHingeKey(a, b) {
  return HINGE_KEYS.has(a < b ? `${a}:${b}` : `${b}:${a}`);
}
